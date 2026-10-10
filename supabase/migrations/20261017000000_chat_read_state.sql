-- Chat read state: what a member has read in each conversation they are in, and the unread counts
-- the sidebar shows. chat_channel_members.last_read_at already exists (the mirror migration);
-- members cannot write to that table, so marking a conversation read goes through a function that
-- only ever touches the caller's own row.

-- Nothing is unread on the day this ships: everyone starts caught up. (A membership created later
-- with no last_read_at counts from when the member joined.)
UPDATE public.chat_channel_members SET last_read_at = now() WHERE last_read_at IS NULL;

-- Mark a conversation read through p_through (the newest message the member had on screen) for the
-- signed-in member. The marker only moves forward and never past now(), so a stale or racing call
-- cannot un-read anything or claim messages that were not shown. SECURITY DEFINER because members
-- have no UPDATE on chat_channel_members; it is bound to current_member_id(), so it can only ever
-- move the caller's own marker, and only for a conversation they are in. Sudo does not call it
-- (read-only). The client calls it when the member leaves a conversation, not when they open it, so
-- the "new messages" line stays put for the whole visit.
CREATE OR REPLACE FUNCTION public.chat_mark_read(p_channel_id UUID, p_through TIMESTAMPTZ DEFAULT now()) RETURNS VOID AS $$
  UPDATE chat_channel_members
  SET last_read_at = GREATEST(COALESCE(last_read_at, '-infinity'::timestamptz), LEAST(p_through, now()))
  WHERE channel_id = p_channel_id
    AND member_id = (SELECT current_member_id())
    AND left_at IS NULL;
$$ LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.chat_mark_read(UUID, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_mark_read(UUID, TIMESTAMPTZ) TO authenticated, service_role;

-- Unread top-level messages per conversation for the signed-in member, capped at 100 each (a badge
-- reads "99+" beyond that; counting further is wasted work). SECURITY INVOKER: RLS still decides
-- which messages count. Not counted: your own messages, replies in threads, deleted messages,
-- archived conversations and ones you have left.
CREATE OR REPLACE FUNCTION public.chat_unread_counts() RETURNS TABLE (channel_id UUID, unread INTEGER) AS $$
  SELECT counted.channel_id, counted.unread
  FROM (
    SELECT cm.channel_id,
      (
        SELECT count(*)::int FROM (
          SELECT 1 FROM chat_messages m
          WHERE m.channel_id = cm.channel_id
            AND m.thread_root_id IS NULL
            AND m.deleted_at IS NULL
            AND m.created_at > COALESCE(cm.last_read_at, cm.joined_at)
            AND m.author_member_id IS DISTINCT FROM cm.member_id
          LIMIT 100
        ) capped
      ) AS unread
    FROM chat_channel_members cm
    JOIN chat_channels c ON c.id = cm.channel_id AND c.archived_at IS NULL
    WHERE cm.member_id = (SELECT current_member_id()) AND cm.left_at IS NULL
  ) counted
  WHERE counted.unread > 0;
$$ LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public;

REVOKE ALL ON FUNCTION public.chat_unread_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_unread_counts() TO authenticated, service_role;
