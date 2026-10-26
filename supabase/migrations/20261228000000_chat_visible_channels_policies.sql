-- The chat_* read policies called chat_can_see_channel(channel) once per row. That function is
-- SECURITY DEFINER (it cannot be inlined) and each call looks up the caller (current_member_id()
-- scans members), the channel and its membership. For chat_reactions the policy went through
-- chat_messages, and the planner chose to evaluate it for every message in the table, not just the
-- ones asked for: in production (5.8k messages) the reactions of a 40-message page took 0.6-2.6s;
-- on a copy of that size locally 390ms, against 5ms with the change below. chat_channels,
-- chat_channel_members and chat_messages had the same per-row call (the channel list's first two
-- queries took 50-320ms each).
--
-- chat_visible_channel_ids() returns, once per statement, the channels the caller can see. The
-- policies test membership in that set (a hashed subplan), so the cost no longer grows with the
-- rows read. Same rule as chat_can_see_channel: admins see every channel; a member sees public
-- channels and the ones they are in (left_at IS NULL). chat_can_see_channel stays, for the
-- functions and policies that still use it (chat_message_contents, search, posting).

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
     );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.chat_visible_channel_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_visible_channel_ids() TO authenticated, service_role;

COMMENT ON FUNCTION public.chat_visible_channel_ids() IS
  'The channels the caller can see (what chat_can_see_channel allows), computed once per statement so a policy can test membership in the set instead of calling a function per row.';

DROP POLICY IF EXISTS "See visible channels" ON public.chat_channels;
CREATE POLICY "See visible channels" ON public.chat_channels
  FOR SELECT TO authenticated USING (id IN (SELECT public.chat_visible_channel_ids()));

DROP POLICY IF EXISTS "See members of visible channels" ON public.chat_channel_members;
CREATE POLICY "See members of visible channels" ON public.chat_channel_members
  FOR SELECT TO authenticated USING (channel_id IN (SELECT public.chat_visible_channel_ids()));

DROP POLICY IF EXISTS "See messages of visible channels" ON public.chat_messages;
CREATE POLICY "See messages of visible channels" ON public.chat_messages
  FOR SELECT TO authenticated USING (channel_id IN (SELECT public.chat_visible_channel_ids()));

-- chat_reactions.channel_id (set by a trigger from the message) means no join through chat_messages.
DROP POLICY IF EXISTS "See reactions of visible channels" ON public.chat_reactions;
CREATE POLICY "See reactions of visible channels" ON public.chat_reactions
  FOR SELECT TO authenticated USING (channel_id IN (SELECT public.chat_visible_channel_ids()));
