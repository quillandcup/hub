set lock_timeout = '5s';

-- Hedgie Care: a care plan changes hands only when the receiver accepts (docs/product/HEDGIE_CARE.md, "Owners"; CLAUDE.md,
-- "Hand-overs need both sides"). Until now any staff member could write `owned_by` directly (the Reassign button): nobody
-- can be given a member's care without agreeing, so the owner of a plan now changes only through four steps:
--
--   propose_care_handover  the owner (or an admin, on their behalf) offers the plan to another staff member who may own plans
--   accept_care_handover   the receiver says yes: this is the only way `owned_by` moves
--   decline_care_handover  the receiver says no
--   cancel_care_handover   the proposer, the owner or an admin takes the offer back
--   claim_care_plan        a plan with no owner (the account was removed) is taken by a staff member who wants it
--
-- The plan keeps its owner while an offer is pending. One offer per plan: it is three nullable columns on the plan.
--
-- The rule is in the database, not only in the app: a BEFORE UPDATE trigger refuses any change of `owned_by` that does
-- not come through accept or claim, for every role (an admin, the service role), and any change of the offer itself
-- (handover_*) that does not come through one of the steps, so an offer can't be forged either. The functions set a
-- transaction-local setting the trigger reads (the same mechanism as `app.audit_skip_course`); nothing a client can send
-- sets it, since PostgREST exposes only functions in the public schema. Inserts are not affected: a new plan is owned by
-- whoever starts it, and a renewal keeps its owner. An account removal still empties `owned_by`, `handover_to` and
-- `handover_by` (ON DELETE SET NULL): that is not giving the plan to anyone, so the trigger lets a change to NULL through
-- when it is the database's own foreign-key action (it runs inside another trigger), and refuses it from a plain UPDATE.
--
-- The functions are SECURITY INVOKER, so row-level security applies as for any write, and they check who is calling:
-- `can_own_care_plans(user)` is the one small SECURITY DEFINER helper, because a community manager's own session can't read
-- other users' profiles, and "may this person own plans" (an admin or a community manager; assistants are not offered)
-- lives in `user_profiles`. It answers only a boolean, and only to staff.
--
-- Audit: the proposal and the accept are deltas of the plan (handover_to, handover_by, handover_at, owned_by), written as the
-- person who did them: the existing update trigger leaves out only updated_at and the two last-message times, so these are
-- not noise and nothing here changes it.

ALTER TABLE public.care_engagements
  ADD COLUMN handover_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN handover_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN handover_at timestamptz;

COMMENT ON COLUMN public.care_engagements.handover_to IS 'The staff user a hand-over of this plan is offered to; null when none is pending. The owner does not change until they accept (accept_care_handover).';
COMMENT ON COLUMN public.care_engagements.handover_by IS 'Who proposed the pending hand-over (the owner, or an admin on their behalf).';
COMMENT ON COLUMN public.care_engagements.handover_at IS 'When the pending hand-over was proposed.';

-- "Waiting for you": the plans offered to one person.
CREATE INDEX care_engagements_handover_to_idx ON public.care_engagements (handover_to)
  WHERE handover_to IS NOT NULL AND deleted_at IS NULL;

------------------------------------------------------------------------------------------------
-- Who may own plans. SECURITY DEFINER only so a community manager's session can ask about someone else's role.
------------------------------------------------------------------------------------------------

CREATE FUNCTION public.can_own_care_plans(p_user uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $function$
  SELECT (public.is_admin() OR public.is_community_manager())
     AND EXISTS (SELECT 1 FROM public.user_profiles WHERE id = p_user AND role IN ('admin', 'community_manager'));
$function$;

REVOKE ALL ON FUNCTION public.can_own_care_plans(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_own_care_plans(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.can_own_care_plans(uuid) IS
  'True when the caller is an admin or a community manager and p_user is one too (the roles that may own Hedgie Care plans). Assistants are not. Answers a boolean only, and only to staff.';

------------------------------------------------------------------------------------------------
-- The guard: owned_by changes only through accept_care_handover or claim_care_plan.
------------------------------------------------------------------------------------------------

CREATE FUNCTION public.care_engagements_guard_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  -- 'accepted': accept_care_handover or claim_care_plan (the owner may change). 'step': another step (the offer may change).
  mode text := COALESCE(current_setting('app.care_handover', true), '');
  -- An account removal empties the foreign keys through the database's own action, which runs inside another trigger.
  inside_fk_action boolean := pg_trigger_depth() > 1;
BEGIN
  IF NEW.owned_by IS DISTINCT FROM OLD.owned_by
     AND mode <> 'accepted'
     AND NOT (inside_fk_action AND NEW.owned_by IS NULL) THEN
    RAISE EXCEPTION 'care_handover:owner_change_refused'
      USING ERRCODE = '42501', HINT = 'A care plan changes hands only when the receiver accepts: propose_care_handover, then accept_care_handover.';
  END IF;
  IF (NEW.handover_to, NEW.handover_by, NEW.handover_at) IS DISTINCT FROM (OLD.handover_to, OLD.handover_by, OLD.handover_at)
     AND mode NOT IN ('step', 'accepted')
     AND NOT (inside_fk_action
              AND (NEW.handover_to IS NULL OR NEW.handover_to = OLD.handover_to)
              AND (NEW.handover_by IS NULL OR NEW.handover_by = OLD.handover_by)
              AND NEW.handover_at IS NOT DISTINCT FROM OLD.handover_at) THEN
    RAISE EXCEPTION 'care_handover:offer_change_refused'
      USING ERRCODE = '42501', HINT = 'An offer is made, answered and taken back through propose_care_handover and its siblings.';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER care_engagements_guard_owner
  BEFORE UPDATE ON public.care_engagements
  FOR EACH ROW EXECUTE FUNCTION public.care_engagements_guard_owner();

COMMENT ON FUNCTION public.care_engagements_guard_owner() IS
  'Refuses any change of care_engagements.owned_by that does not come through accept_care_handover or claim_care_plan, and any change of the handover_* offer that does not come through one of the hand-over steps, for every role. Inserts are not touched.';

------------------------------------------------------------------------------------------------
-- The four steps, and the claim. A refusal raises 'care_handover:<reason>' (P0001) so the app can word it.
------------------------------------------------------------------------------------------------

-- Offer a plan (open or closed) to another staff member. By its owner, or by an admin on the owner's behalf.
CREATE FUNCTION public.propose_care_handover(p_id text, p_to uuid)
RETURNS SETOF public.care_engagements
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  me uuid := auth.uid();
  plan public.care_engagements;
BEGIN
  IF me IS NULL OR NOT (public.is_admin() OR public.is_community_manager()) THEN
    RAISE EXCEPTION 'care_handover:not_allowed';
  END IF;
  SELECT * INTO plan FROM public.care_engagements WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'care_handover:not_found';
  END IF;
  IF plan.owned_by IS DISTINCT FROM me AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'care_handover:not_allowed';
  END IF;
  IF p_to IS NULL OR NOT public.can_own_care_plans(p_to) THEN
    RAISE EXCEPTION 'care_handover:receiver_not_allowed';
  END IF;
  IF p_to = plan.owned_by THEN
    RAISE EXCEPTION 'care_handover:same_owner';
  END IF;
  -- Someone who is not the owner (an admin acting for them) can't also be the one who receives it: that would be one person
  -- on both sides of the agreement.
  IF p_to = me THEN
    RAISE EXCEPTION 'care_handover:self';
  END IF;
  IF plan.handover_to IS NOT NULL THEN
    RAISE EXCEPTION 'care_handover:already_pending';
  END IF;

  PERFORM set_config('app.care_handover', 'step', true);
  RETURN QUERY
  UPDATE public.care_engagements
     SET handover_to = p_to, handover_by = me, handover_at = now()
   WHERE id = p_id
  RETURNING *;
  PERFORM set_config('app.care_handover', '', true);
END;
$function$;

-- The receiver says yes: the one way the owner changes.
CREATE FUNCTION public.accept_care_handover(p_id text)
RETURNS SETOF public.care_engagements
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  me uuid := auth.uid();
  plan public.care_engagements;
BEGIN
  IF me IS NULL OR NOT (public.is_admin() OR public.is_community_manager()) THEN
    RAISE EXCEPTION 'care_handover:not_allowed';
  END IF;
  SELECT * INTO plan FROM public.care_engagements WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'care_handover:not_found';
  END IF;
  IF plan.handover_to IS DISTINCT FROM me THEN
    RAISE EXCEPTION 'care_handover:no_handover';
  END IF;
  -- Accepting is a decision made now: the role is read now, not when the plan was offered.
  IF NOT public.can_own_care_plans(me) THEN
    RAISE EXCEPTION 'care_handover:receiver_not_allowed';
  END IF;

  PERFORM set_config('app.care_handover', 'accepted', true);
  RETURN QUERY
  UPDATE public.care_engagements
     SET owned_by = me, handover_to = NULL, handover_by = NULL, handover_at = NULL
   WHERE id = p_id
  RETURNING *;
  PERFORM set_config('app.care_handover', '', true);
END;
$function$;

-- The receiver says no: the owner stays, the offer is gone.
CREATE FUNCTION public.decline_care_handover(p_id text)
RETURNS SETOF public.care_engagements
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  me uuid := auth.uid();
  plan public.care_engagements;
BEGIN
  IF me IS NULL OR NOT (public.is_admin() OR public.is_community_manager()) THEN
    RAISE EXCEPTION 'care_handover:not_allowed';
  END IF;
  SELECT * INTO plan FROM public.care_engagements WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'care_handover:not_found';
  END IF;
  IF plan.handover_to IS DISTINCT FROM me THEN
    RAISE EXCEPTION 'care_handover:no_handover';
  END IF;

  PERFORM set_config('app.care_handover', 'step', true);
  RETURN QUERY
  UPDATE public.care_engagements
     SET handover_to = NULL, handover_by = NULL, handover_at = NULL
   WHERE id = p_id
  RETURNING *;
  PERFORM set_config('app.care_handover', '', true);
END;
$function$;

-- The proposer, the owner or an admin takes the offer back.
CREATE FUNCTION public.cancel_care_handover(p_id text)
RETURNS SETOF public.care_engagements
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  me uuid := auth.uid();
  plan public.care_engagements;
BEGIN
  IF me IS NULL OR NOT (public.is_admin() OR public.is_community_manager()) THEN
    RAISE EXCEPTION 'care_handover:not_allowed';
  END IF;
  SELECT * INTO plan FROM public.care_engagements WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'care_handover:not_found';
  END IF;
  IF plan.handover_to IS NULL THEN
    RAISE EXCEPTION 'care_handover:no_handover';
  END IF;
  IF me IS DISTINCT FROM plan.handover_by AND me IS DISTINCT FROM plan.owned_by AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'care_handover:not_allowed';
  END IF;

  PERFORM set_config('app.care_handover', 'step', true);
  RETURN QUERY
  UPDATE public.care_engagements
     SET handover_to = NULL, handover_by = NULL, handover_at = NULL
   WHERE id = p_id
  RETURNING *;
  PERFORM set_config('app.care_handover', '', true);
END;
$function$;

-- A plan with no owner (the account was removed) is taken by a staff member who accepts it. Any offer it had is gone with it.
CREATE FUNCTION public.claim_care_plan(p_id text)
RETURNS SETOF public.care_engagements
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  me uuid := auth.uid();
  plan public.care_engagements;
BEGIN
  IF me IS NULL OR NOT public.can_own_care_plans(me) THEN
    RAISE EXCEPTION 'care_handover:not_allowed';
  END IF;
  SELECT * INTO plan FROM public.care_engagements WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'care_handover:not_found';
  END IF;
  IF plan.owned_by IS NOT NULL THEN
    RAISE EXCEPTION 'care_handover:has_owner';
  END IF;

  PERFORM set_config('app.care_handover', 'accepted', true);
  RETURN QUERY
  UPDATE public.care_engagements
     SET owned_by = me, handover_to = NULL, handover_by = NULL, handover_at = NULL
   WHERE id = p_id
  RETURNING *;
  PERFORM set_config('app.care_handover', '', true);
END;
$function$;

-- Renewing: the same function as before (same signature, so CREATE OR REPLACE), and an offer that is pending follows the plan:
-- the closed plan no longer shows it, the new one carries it, so the receiver is still being offered the plan that is live.
CREATE OR REPLACE FUNCTION public.renew_care_engagement(p_id text, p_period_ends_on date, p_opened_by uuid, p_at timestamptz, p_notes text)
RETURNS SETOF public.care_engagements
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  offer public.care_engagements;
  previous public.care_engagements;
BEGIN
  SELECT * INTO offer FROM public.care_engagements WHERE id = p_id AND closed_at IS NULL AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  PERFORM set_config('app.care_handover', 'step', true);
  UPDATE public.care_engagements
     SET closed_at = p_at, ended_how = 'renewed', handover_to = NULL, handover_by = NULL, handover_at = NULL
   WHERE id = p_id
  RETURNING * INTO previous;
  PERFORM set_config('app.care_handover', '', true);

  RETURN QUERY
  INSERT INTO public.care_engagements (member_id, opened_by, owned_by, reason, opened_at, period_ends_on, renewed_from, last_staff_message_at, last_member_message_at, notes, handover_to, handover_by, handover_at)
  VALUES (previous.member_id, p_opened_by, previous.owned_by, previous.reason, p_at, p_period_ends_on, previous.id, previous.last_staff_message_at, previous.last_member_message_at, p_notes, offer.handover_to, offer.handover_by, offer.handover_at)
  RETURNING *;
END;
$function$;

REVOKE ALL ON FUNCTION public.propose_care_handover(text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_care_handover(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.decline_care_handover(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_care_handover(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_care_plan(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.propose_care_handover(text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accept_care_handover(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decline_care_handover(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_care_handover(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_care_plan(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.propose_care_handover(text, uuid) IS
  'Offers a care plan to another staff member who may own plans. The owner (or an admin on their behalf) proposes; nothing changes until the receiver accepts. One offer per plan. Refusals raise care_handover:<reason>. SECURITY INVOKER: RLS applies.';
COMMENT ON FUNCTION public.accept_care_handover(text) IS
  'The receiver accepts the offered plan: they become its owner (the only way owned_by changes, with claim_care_plan) and the offer is cleared. SECURITY INVOKER: RLS applies.';
COMMENT ON FUNCTION public.decline_care_handover(text) IS
  'The receiver declines the offered plan: the owner stays and the offer is cleared. SECURITY INVOKER: RLS applies.';
COMMENT ON FUNCTION public.cancel_care_handover(text) IS
  'The proposer, the owner or an admin takes a pending offer back. SECURITY INVOKER: RLS applies.';
COMMENT ON FUNCTION public.claim_care_plan(text) IS
  'A staff member who may own plans takes a plan that has no owner (its owner account was removed). Clears any pending offer. SECURITY INVOKER: RLS applies.';

COMMENT ON TABLE public.care_engagements IS
  'LOCAL: Hedgie Care, a staff member''s reach-out to one member for one period (a care plan). The status (needs reply, waiting, gone quiet, review due, lapsed) is derived in lib/care.ts from the dates and from who spoke last (last_staff_message_at / last_member_message_at, logged by hand or derived from the owner''s tracked Slack DM with the member), never stored. renewed_from links a renewal to the plan it continues. One open plan per member, whatever the channel. The owner (owned_by) is whoever started it and changes only when the receiver accepts a hand-over (handover_* columns; propose/accept/decline/cancel_care_handover; a trigger refuses any other change). Soft delete (deleted_at). Staff only (admin and community manager). Not reprocessed. Tier 2: the id is never shown in a URL or export. [id prefix: care_]';
