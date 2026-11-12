set lock_timeout = '5s';

-- Hedgie Care: a care plan belongs to a member, not to a channel (docs/HEDGIE_CARE.md). The first build gave each plan a
-- channel (Slack DM, prickle, email, other) and allowed one open plan per member AND channel. What the community manager
-- needs is one plan per member, with every channel (Slack DMs now, emails and Instagram DMs later) and the member's own
-- activity read against it, so nothing about a plan says where it happens.
--
-- Expand only. The code in production still writes `channel` (NOT NULL, CHECKed), so the column and its CHECK stay for now:
-- it gets a default, which is what the new code leaves it at by not writing it. Dropping the column and its CHECK is the
-- contract step, a later PR once this has deployed (docs/TODO.md, "Hedgie Care: drop care_engagements.channel").
--
-- Before this, production held at most one open plan per member (checked read-only before writing this), so the new
-- unique index can be built. Then the old (member_id, channel) index goes: the new one is stricter, so it can never allow a
-- row the old one refused, and nothing reads it (the old code's "already open" lookup is by columns, not by index name).

ALTER TABLE public.care_engagements ALTER COLUMN channel SET DEFAULT 'other';

COMMENT ON COLUMN public.care_engagements.channel IS
  'DEPRECATED, no longer read or written by the app: a care plan belongs to a member, not a channel. Kept (NOT NULL, defaulted to other) until the contract step drops it. Do not use.';

-- One open plan per member: a second hello continues the first, whichever way it reaches them.
CREATE UNIQUE INDEX care_engagements_one_open_per_member
  ON public.care_engagements (member_id)
  WHERE closed_at IS NULL AND deleted_at IS NULL;

DROP INDEX public.care_engagements_one_open_per_member_channel;

COMMENT ON TABLE public.care_engagements IS
  'LOCAL: Hedgie Care, a staff member''s reach-out to one member for one period (a care plan). The status (needs reply, waiting, gone quiet, review due, lapsed) is derived in lib/care.ts from the dates and from who spoke last (last_staff_message_at / last_member_message_at, logged by hand or derived from the owner''s tracked Slack DM with the member), never stored. renewed_from links a renewal to the plan it continues. One open plan per member, whatever the channel. Soft delete (deleted_at). Staff only (admin and community manager). Not reprocessed. Tier 2: the id is never shown in a URL or export. [id prefix: care_]';

-- Renewing: the same function as before (same signature, so CREATE OR REPLACE), without the channel. The new period keeps
-- the reason, the owner and who spoke last; the note is why she renewed.
CREATE OR REPLACE FUNCTION public.renew_care_engagement(p_id text, p_period_ends_on date, p_opened_by uuid, p_at timestamptz, p_notes text)
RETURNS SETOF public.care_engagements
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  previous public.care_engagements;
BEGIN
  UPDATE public.care_engagements
     SET closed_at = p_at, ended_how = 'renewed'
   WHERE id = p_id AND closed_at IS NULL AND deleted_at IS NULL
  RETURNING * INTO previous;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  INSERT INTO public.care_engagements (member_id, opened_by, owned_by, reason, opened_at, period_ends_on, renewed_from, last_staff_message_at, last_member_message_at, notes)
  VALUES (previous.member_id, p_opened_by, previous.owned_by, previous.reason, p_at, p_period_ends_on, previous.id, previous.last_staff_message_at, previous.last_member_message_at, p_notes)
  RETURNING *;
END;
$function$;
