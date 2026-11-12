set lock_timeout = '5s';

-- Direct messages that include a member of the team can be read by the whole team (decided 2026-11-12).
--
-- Before: every direct message and group message was restricted (chat_channels_dms_restricted), so an admin read the
-- text only through break-glass access, and a community manager could not see chat at all. Now a DM or group DM with
-- a staff member in it is readable, without a grant, by every admin and every community manager. A DM with no staff
-- member in it is exactly as before. The stored `restricted` flag does not change (the constraint stays); the rule is
-- derived, so a staff member joining or leaving a conversation changes who can read it with no data to fix up.
--
-- "Staff member" is defined once, here: a member linked in `staff`, or the member behind an admin or community manager
-- account. lib/data/staff.ts (StaffRepository.memberIds) asks this function; nothing else defines it.
--
-- The text of a Slack DM lives in chat_message_contents for the Hub members' chat (the pulls put it there), and that is
-- what the policies below open up. bronze.slack_messages stays service role only: nothing here widens it.

-- The member ids that are staff. Service role only (it is the TypeScript side's read).
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
  WHERE p.role IN ('admin', 'community_manager');
$function$;

REVOKE ALL ON FUNCTION public.staff_member_ids() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_member_ids() TO service_role;
COMMENT ON FUNCTION public.staff_member_ids() IS
  'The one definition of a staff member: members linked in staff, and the members behind admin and community manager accounts. Service role only.';

CREATE OR REPLACE FUNCTION public.is_staff_member(p_member text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p_member IS NOT NULL AND EXISTS (SELECT 1 FROM public.staff_member_ids() i WHERE i = p_member);
$function$;

REVOKE ALL ON FUNCTION public.is_staff_member(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_staff_member(text) TO service_role;
COMMENT ON FUNCTION public.is_staff_member(text) IS
  'Whether the member is staff (staff_member_ids()). Internal: called from the chat policies'' functions, which run as their owner.';

-- Whether a direct or group message has a staff member in it now: a Hub member in the conversation (chat_channel_members)
-- or, for a Slack conversation, anyone Slack lists in it (bronze.slack_channel_members, matched to a member through
-- chat_slack_authors). Slack's list matters because a Slack DM is in the chat of the members who pulled their own DMs
-- only, so a staff member who has not connected would not be in chat_channel_members. Internal: no grant to signed-in users.
CREATE OR REPLACE FUNCTION public.chat_dm_has_staff(p_channel_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM chat_channels c
    WHERE c.id = p_channel_id
      AND c.kind IN ('dm', 'group_dm')
      AND (
        EXISTS (
          SELECT 1 FROM chat_channel_members cm
          WHERE cm.channel_id = c.id AND cm.left_at IS NULL AND public.is_staff_member(cm.member_id)
        )
        OR (
          c.slack_channel_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM bronze.slack_channel_members b
            JOIN chat_slack_authors a ON a.slack_user_id = b.user_id
            WHERE b.channel_id = c.slack_channel_id AND b.left_at IS NULL AND public.is_staff_member(a.member_id)
          )
        )
      )
  );
$function$;

REVOKE ALL ON FUNCTION public.chat_dm_has_staff(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_dm_has_staff(text) TO service_role;
COMMENT ON FUNCTION public.chat_dm_has_staff(text) IS
  'Whether a direct or group message has a staff member in it now. Internal: the chat policies and chat_channel_includes_staff call it.';

-- Used by Hub Chat to tell everyone in a conversation that the team can read it. Answers only for a conversation the
-- caller can see (a participant, an admin, or a community manager who may read it; the server itself sees all), so it
-- cannot be used to ask whether some other pair of people includes staff.
CREATE OR REPLACE FUNCTION public.chat_channel_includes_staff(p_channel_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT (public.chat_can_see_channel(p_channel_id) OR auth.role() = 'service_role') AND public.chat_dm_has_staff(p_channel_id);
$function$;

REVOKE ALL ON FUNCTION public.chat_channel_includes_staff(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_channel_includes_staff(text) TO authenticated, service_role;
COMMENT ON FUNCTION public.chat_channel_includes_staff(text) IS
  'Whether a direct or group message the caller can see has a staff member in it, so the team can read it. False for a conversation the caller cannot see (the service role sees every one).';

-- Whether the caller may read this conversation's text as a member of the team who is not in it: an admin or a community
-- manager, and the conversation is a DM or group DM with staff in it.
CREATE OR REPLACE FUNCTION public.chat_staff_can_read_dm(p_channel_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT ((SELECT public.is_admin()) OR (SELECT public.is_community_manager())) AND public.chat_dm_has_staff(p_channel_id);
$function$;

REVOKE ALL ON FUNCTION public.chat_staff_can_read_dm(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_staff_can_read_dm(text) TO authenticated, service_role;
COMMENT ON FUNCTION public.chat_staff_can_read_dm(text) IS
  'True for an admin or a community manager and a direct or group message with a staff member in it: the team may read it without break-glass access.';

-- Content: the one new way in. A participant, a public channel and (for admins) a channel that is not restricted
-- are as before.
CREATE OR REPLACE FUNCTION public.chat_can_read_content(p_channel_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM chat_channels c
    WHERE c.id = p_channel_id
      AND (
        chat_is_channel_member(c.id)
        OR (c.visibility = 'public' AND (SELECT current_member_id()) IS NOT NULL)
        OR (NOT c.restricted AND (SELECT is_admin()))
        OR chat_staff_can_read_dm(c.id)
      )
  );
$function$;

-- Seeing a conversation (its members, who wrote and when, reactions): admins see every one, as before. A community
-- manager sees no chat except the conversations she may read.
CREATE OR REPLACE FUNCTION public.chat_can_see_channel(p_channel_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT (SELECT is_admin())
      OR EXISTS (
        SELECT 1 FROM chat_channels c
        WHERE c.id = p_channel_id
          AND (
            (c.visibility = 'public' AND (SELECT current_member_id()) IS NOT NULL)
            OR chat_is_channel_member(c.id)
          )
      )
      OR ((SELECT is_community_manager()) AND chat_dm_has_staff(p_channel_id));
$function$;

-- The set the read policies test membership in (20261228000000). The CASE keeps the community manager lookup off
-- every other caller's path: for them it is a constant false.
CREATE OR REPLACE FUNCTION public.chat_visible_channel_ids() RETURNS SETOF text AS $$
  SELECT c.id
  FROM chat_channels c
  WHERE (SELECT is_admin())
     OR (c.visibility = 'public' AND (SELECT current_member_id()) IS NOT NULL)
     OR c.id IN (
       SELECT cm.channel_id
       FROM chat_channel_members cm
       WHERE cm.member_id = (SELECT current_member_id())
         AND cm.left_at IS NULL
     )
     OR CASE WHEN (SELECT is_community_manager()) AND c.kind IN ('dm', 'group_dm') THEN chat_dm_has_staff(c.id) ELSE false END;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION public.chat_visible_channel_ids() IS
  'The channels the caller can see (what chat_can_see_channel allows), computed once per statement so a policy can test membership in the set instead of calling a function per row.';

-- A read of a conversation by a member of the team who is not in it is written to the audit log, so there is a trail
-- (docs/ACTIVITY_AND_AUDIT_LOG.md; the Activity Log's Privacy view). One entry per person and conversation per hour,
-- so opening the same page again does not bury it. Nothing is written for a participant, or for someone who may not
-- read the conversation. The entry names the conversation (its id), the person who read it and when; never the text,
-- and no member: the row is about the reader's access, not about a member.
CREATE OR REPLACE FUNCTION public.chat_log_staff_dm_read(p_channel_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.chat_staff_can_read_dm(p_channel_id) THEN
    RETURN false;
  END IF;
  -- A staff member reading their own conversation is not a read of someone else's.
  IF public.chat_is_channel_member(p_channel_id) THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1 FROM audit_log a
    WHERE a.entity_type = 'staff_dm_read' AND a.entity_id = p_channel_id AND a.changed_by = v_uid
      AND a.occurred_at > now() - interval '1 hour'
  ) THEN
    RETURN true;
  END IF;
  INSERT INTO audit_log (changed_by, actor_kind, acting_as_member_id, entity_type, entity_id, action, changes)
  VALUES (
    v_uid, 'staff', public.current_acting_as_member_id(), 'staff_dm_read', p_channel_id, 'insert',
    jsonb_build_object('channel', jsonb_build_object('old', NULL, 'new', p_channel_id))
  );
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.chat_log_staff_dm_read(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_log_staff_dm_read(text) TO authenticated;
COMMENT ON FUNCTION public.chat_log_staff_dm_read(text) IS
  'Writes one audit entry (per reader and conversation per hour) when an admin or community manager who is not in a staff-involved DM opens it. True when the read is on record, false when no entry applies.';
