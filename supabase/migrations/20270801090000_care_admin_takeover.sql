set lock_timeout = '5s';

-- Hedgie Care: an admin can take over a care plan from its owner without the owner agreeing (the owner's decision, 2026-11-15:
-- "admins can always take over a care plan, and tell the previous owner on their page"). This is the one exception to
-- "hand-overs need both sides" (CLAUDE.md; docs/product/HEDGIE_CARE.md, "Owners"), for an owner who is unreachable or when an admin has
-- to step in. Nobody else gets it: a community manager still needs the receiver's agreement and may only take a plan that has
-- no owner (the owner's account was removed). The database guard on `owned_by` stays for every other path, admin and the
-- service role included: the owner changes only through accept_care_handover or claim_care_plan.
--
-- 1. claim_care_plan(p_id) gets a new body (CREATE OR REPLACE, same signature, so the code live during a deploy keeps working):
--      - a plan with no owner: any staff member who may own plans takes it, as before (open or closed);
--      - a plan with an owner: only an admin, and only an open plan (a closed or renewed plan keeps its owner: nothing is
--        being looked after any more). A plan that is open but past its last day (lapsed) can be taken: that is when it is
--        needed. An admin who already owns it is refused (already_yours), a community manager is refused as before
--        (has_owner), an assistant or a plain member is not_allowed.
--      - any pending hand-over offer is cleared, and the takeover is written on the plan (below).
-- 2. A notice for the previous owner, on the page only (nothing is sent): the last takeover is four nullable columns on the plan.
--    They are written only by claim_care_plan, and the guard refuses a forged change of them like it does the handover_*
--    columns. dismiss_care_takeover_notice lets the previous owner (and only them) mark it seen. A later takeover replaces the
--    notice. A hand-over does not touch it: it stays a true fact about the plan until its reader dismisses it.
-- 3. The guard learns two more steps ('takeover': the owner, the offer and the notice may change; 'seen': only taken_seen_at).
--
-- Audit: the takeover is a delta of the plan (owned_by, the notice columns, the offer cleared) written as the admin, and the
-- previous owner's dismissal is a delta of taken_seen_at as the previous owner (their own acknowledgement, one entry each;
-- the existing update trigger is not changed, so nothing here collides with the other triggers on this table).

ALTER TABLE public.care_engagements
  ADD COLUMN taken_from uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN taken_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN taken_at timestamptz,
  ADD COLUMN taken_seen_at timestamptz;

COMMENT ON COLUMN public.care_engagements.taken_from IS 'The staff user this plan was last taken over from by an admin (claim_care_plan), who sees a notice on their Hedgie Care page; null when it was never taken over. Written only by claim_care_plan.';
COMMENT ON COLUMN public.care_engagements.taken_by IS 'The admin who took the plan over. Written only by claim_care_plan.';
COMMENT ON COLUMN public.care_engagements.taken_at IS 'When the plan was taken over. Written only by claim_care_plan.';
COMMENT ON COLUMN public.care_engagements.taken_seen_at IS 'When the previous owner (taken_from) dismissed the notice; null while it is waiting. Written only by dismiss_care_takeover_notice (and cleared by the next takeover).';

-- The previous owner's notices still waiting.
CREATE INDEX care_engagements_taken_from_idx ON public.care_engagements (taken_from)
  WHERE taken_from IS NOT NULL AND taken_seen_at IS NULL AND deleted_at IS NULL;

------------------------------------------------------------------------------------------------
-- The guard: now with the takeover and its notice. Same signature as before (CREATE OR REPLACE), so the trigger stays.
------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.care_engagements_guard_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  -- 'accepted': accept_care_handover or a claim of a plan with no owner (the owner may change). 'takeover': an admin's takeover
  -- (the owner, the offer and the notice may change). 'step': another hand-over step (the offer may change). 'seen': the
  -- previous owner dismissing the notice (only taken_seen_at may change).
  mode text := COALESCE(current_setting('app.care_handover', true), '');
  -- An account removal empties the foreign keys through the database's own action, which runs inside another trigger.
  inside_fk_action boolean := pg_trigger_depth() > 1;
BEGIN
  IF NEW.owned_by IS DISTINCT FROM OLD.owned_by
     AND mode NOT IN ('accepted', 'takeover')
     AND NOT (inside_fk_action AND NEW.owned_by IS NULL) THEN
    RAISE EXCEPTION 'care_handover:owner_change_refused'
      USING ERRCODE = '42501', HINT = 'A care plan changes hands only when the receiver accepts (propose_care_handover, then accept_care_handover), or when an admin takes it over (claim_care_plan).';
  END IF;
  IF (NEW.handover_to, NEW.handover_by, NEW.handover_at) IS DISTINCT FROM (OLD.handover_to, OLD.handover_by, OLD.handover_at)
     AND mode NOT IN ('step', 'accepted', 'takeover')
     AND NOT (inside_fk_action
              AND (NEW.handover_to IS NULL OR NEW.handover_to = OLD.handover_to)
              AND (NEW.handover_by IS NULL OR NEW.handover_by = OLD.handover_by)
              AND NEW.handover_at IS NOT DISTINCT FROM OLD.handover_at) THEN
    RAISE EXCEPTION 'care_handover:offer_change_refused'
      USING ERRCODE = '42501', HINT = 'An offer is made, answered and taken back through propose_care_handover and its siblings.';
  END IF;
  -- Who took the plan over, from whom and when: only the takeover writes them. An account removal may empty the two users.
  IF (NEW.taken_from, NEW.taken_by, NEW.taken_at) IS DISTINCT FROM (OLD.taken_from, OLD.taken_by, OLD.taken_at)
     AND mode <> 'takeover'
     AND NOT (inside_fk_action
              AND (NEW.taken_from IS NULL OR NEW.taken_from = OLD.taken_from)
              AND (NEW.taken_by IS NULL OR NEW.taken_by = OLD.taken_by)
              AND NEW.taken_at IS NOT DISTINCT FROM OLD.taken_at) THEN
    RAISE EXCEPTION 'care_handover:notice_change_refused'
      USING ERRCODE = '42501', HINT = 'Only claim_care_plan writes a takeover.';
  END IF;
  IF NEW.taken_seen_at IS DISTINCT FROM OLD.taken_seen_at AND mode NOT IN ('takeover', 'seen') THEN
    RAISE EXCEPTION 'care_handover:notice_change_refused'
      USING ERRCODE = '42501', HINT = 'Only the previous owner dismisses the notice, through dismiss_care_takeover_notice.';
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.care_engagements_guard_owner() IS
  'Refuses any change of care_engagements.owned_by that does not come through accept_care_handover or claim_care_plan, any change of the handover_* offer that does not come through a hand-over step or a takeover, and any change of the taken_* notice that does not come through claim_care_plan (taken_seen_at: or dismiss_care_takeover_notice), for every role. Inserts are not touched.';

------------------------------------------------------------------------------------------------
-- claim_care_plan: a plan with no owner is taken by anyone who may own plans; an admin may also take an open plan from its owner.
------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.claim_care_plan(p_id text)
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

  IF plan.owned_by IS NULL THEN
    -- No owner (the account was removed): whoever may own plans takes it. Nobody is being taken it from, so no notice.
    PERFORM set_config('app.care_handover', 'accepted', true);
    RETURN QUERY
    UPDATE public.care_engagements
       SET owned_by = me, handover_to = NULL, handover_by = NULL, handover_at = NULL
     WHERE id = p_id
    RETURNING *;
    PERFORM set_config('app.care_handover', '', true);
    RETURN;
  END IF;

  -- An owner is there: taking the plan without their agreement is for an admin only (a community manager needs the
  -- receiver's agreement, which is a hand-over).
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'care_handover:has_owner';
  END IF;
  IF plan.owned_by = me THEN
    RAISE EXCEPTION 'care_handover:already_yours';
  END IF;
  -- A closed (or renewed) plan keeps its owner: there is nothing being looked after to take over.
  IF plan.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'care_handover:plan_closed';
  END IF;

  PERFORM set_config('app.care_handover', 'takeover', true);
  RETURN QUERY
  UPDATE public.care_engagements
     SET owned_by = me,
         handover_to = NULL, handover_by = NULL, handover_at = NULL,
         taken_from = plan.owned_by, taken_by = me, taken_at = now(), taken_seen_at = NULL
   WHERE id = p_id
  RETURNING *;
  PERFORM set_config('app.care_handover', '', true);
END;
$function$;

COMMENT ON FUNCTION public.claim_care_plan(text) IS
  'A staff member who may own plans takes a plan that has no owner (its owner account was removed); an admin may also take an open plan from its owner without their agreement (the one exception to hand-overs needing both sides), which leaves a notice for the previous owner (taken_from, taken_by, taken_at). A community manager needs the receiver''s agreement (a hand-over). A closed plan keeps its owner. Clears any pending offer. Refusals raise care_handover:<reason>. SECURITY INVOKER: RLS applies.';

------------------------------------------------------------------------------------------------
-- The previous owner dismisses the notice. Only they can: it is their acknowledgement.
------------------------------------------------------------------------------------------------

CREATE FUNCTION public.dismiss_care_takeover_notice(p_id text)
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
  IF plan.taken_from IS DISTINCT FROM me THEN
    RAISE EXCEPTION 'care_handover:no_notice';
  END IF;
  -- Already dismissed (a second click): nothing to write, so no second audit entry.
  IF plan.taken_seen_at IS NOT NULL THEN
    RETURN NEXT plan;
    RETURN;
  END IF;

  PERFORM set_config('app.care_handover', 'seen', true);
  RETURN QUERY
  UPDATE public.care_engagements
     SET taken_seen_at = now()
   WHERE id = p_id
  RETURNING *;
  PERFORM set_config('app.care_handover', '', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.dismiss_care_takeover_notice(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dismiss_care_takeover_notice(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.dismiss_care_takeover_notice(text) IS
  'The previous owner (taken_from) marks the notice that an admin took their care plan over as seen. Only they can; a second call changes nothing. Refusals raise care_handover:<reason>. SECURITY INVOKER: RLS applies.';

COMMENT ON TABLE public.care_engagements IS
  'LOCAL: Hedgie Care, a staff member''s reach-out to one member for one period (a care plan). The status (needs reply, waiting, gone quiet, review due, lapsed) is derived in lib/care.ts from the dates and from who spoke last (last_staff_message_at / last_member_message_at, logged by hand or derived from the owner''s tracked Slack DM with the member), never stored. renewed_from links a renewal to the plan it continues. One open plan per member, whatever the channel. The owner (owned_by) is whoever started it and changes only when the receiver accepts a hand-over (handover_* columns; propose/accept/decline/cancel_care_handover) or when an admin takes an open plan over (claim_care_plan; taken_* columns hold the notice for the previous owner); a trigger refuses any other change. Soft delete (deleted_at). Staff only (admin and community manager). Not reprocessed. Tier 2: the id is never shown in a URL or export. [id prefix: care_]';
