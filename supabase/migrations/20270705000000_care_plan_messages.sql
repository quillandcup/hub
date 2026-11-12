set lock_timeout = '5s';

-- Messages in a Hedgie Care plan, seen by the team (decided 2026-11-12).
--
-- Direct messages with a staff member stay exactly as before (break-glass only; chat_channels_dms_restricted and every
-- chat read policy are untouched). The one exception is built in the app, not in these policies: Hedgie Care shows the
-- messages of a member's tracked DM(s) sent inside that member's care plans to admins and community managers, read with
-- the service role after a staff check (lib/care-messages.ts). What this migration adds is the small database side of it:
--
--   1. staff_member_ids(): the one definition of "a staff member", read by StaffRepository.memberIds().
--   2. chat_dm_in_care_plan(): whether a chat DM is one tracked in a care plan of its member, for the notice at the top of
--      the conversation in Hub Chat.
--   3. care_log_messages_read(): the audit entry when an admin or community manager opens a member's plan messages.

-- 1. A staff member: a member linked in the staff roster, or the member behind an admin, assistant or community manager
--    account. (Who may READ plan messages is narrower, admins and community managers, and is decided in the app.)
CREATE OR REPLACE FUNCTION public.staff_member_ids()
 RETURNS SETOF text
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT s.member_id FROM staff s WHERE s.member_id IS NOT NULL
  UNION
  SELECT m.id
  FROM members m
  JOIN user_profiles p ON p.id = m.user_id
  WHERE p.role IN ('admin', 'assistant', 'community_manager');
$function$;

REVOKE ALL ON FUNCTION public.staff_member_ids() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_member_ids() TO service_role;
COMMENT ON FUNCTION public.staff_member_ids() IS
  'The one definition of a staff member: members linked in the staff roster, and the members behind admin, assistant and community manager accounts. Service role only.';

-- 2. Whether a Slack DM in the chat is tracked for a care plan: a live care_tracked_dms row for its Slack conversation whose
--    member has a (not removed) care plan owned by the person who tracks it (the owner, else who opened it). Answers only
--    for a conversation the caller can see (the server itself sees all), so it cannot be used to probe other people's DMs.
CREATE OR REPLACE FUNCTION public.chat_dm_in_care_plan(p_channel_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT (public.chat_can_see_channel(p_channel_id) OR auth.role() = 'service_role')
     AND EXISTS (
       SELECT 1
       FROM chat_channels c
       JOIN care_tracked_dms t ON t.slack_channel_id = c.slack_channel_id AND t.deleted_at IS NULL
       WHERE c.id = p_channel_id
         AND c.kind = 'dm'
         AND EXISTS (
           SELECT 1 FROM care_engagements e
           WHERE e.member_id = t.member_id
             AND e.deleted_at IS NULL
             AND COALESCE(e.owned_by, e.opened_by) = t.tracked_by
         )
     );
$function$;

REVOKE ALL ON FUNCTION public.chat_dm_in_care_plan(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_dm_in_care_plan(text) TO authenticated, service_role;
COMMENT ON FUNCTION public.chat_dm_in_care_plan(text) IS
  'Whether a chat DM the caller can see is tracked in a Hedgie Care plan of its member (open or past), so the team can read the messages sent during a plan. Drives the notice in Hub Chat.';

-- 3. The trail. An admin or community manager opening a member's plan messages leaves one audit entry per reader and member per
--    hour: entity_type care_dm_read, the reader as changed_by, the member as entity and member, never any text. Called with
--    the reader's own client, so the entry is theirs. Nothing is written for anyone else (a member, an assistant, signed out).
CREATE OR REPLACE FUNCTION public.care_log_messages_read(p_member_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT ((SELECT public.is_admin()) OR (SELECT public.is_community_manager())) THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM members m WHERE m.id = p_member_id) THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1 FROM audit_log a
    WHERE a.entity_type = 'care_dm_read' AND a.entity_id = p_member_id AND a.changed_by = v_uid
      AND a.occurred_at > now() - interval '1 hour'
  ) THEN
    RETURN true;
  END IF;
  INSERT INTO audit_log (changed_by, actor_kind, acting_as_member_id, entity_type, entity_id, action, changes, member_id)
  VALUES (
    v_uid, 'staff', public.current_acting_as_member_id(), 'care_dm_read', p_member_id, 'insert',
    jsonb_build_object('member', jsonb_build_object('old', NULL, 'new', p_member_id)), p_member_id
  );
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.care_log_messages_read(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.care_log_messages_read(text) TO authenticated;
COMMENT ON FUNCTION public.care_log_messages_read(text) IS
  'Writes one audit entry (per reader and member per hour) when an admin or community manager opens a member''s Hedgie Care plan messages. True when the read is on record, false when no entry applies. Holds no text.';
