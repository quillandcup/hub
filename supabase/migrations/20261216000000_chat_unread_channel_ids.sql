-- The conversations where a member has unread in the Hub, newest activity first. The Slack -> Hub
-- read pull (lib/chat/slack-read.ts, pullReadFromSlack) only needs Slack's marker for these: it
-- moves the Hub marker forward and never backward, so a conversation with nothing unread in the
-- Hub can't change. Asking Slack about every conversation the member is in took several seconds
-- (conversations.info is rate limited and was called for all of them).
--
-- Same predicate as chat_unread_counts (top-level messages by others, not deleted, after the
-- marker or the join; not archived, not left), but keyed by member id instead of the caller's
-- session, because the pull runs in a server action with the service role. Service role only.
CREATE OR REPLACE FUNCTION public.chat_unread_channel_ids(p_member TEXT) RETURNS TABLE (channel_id TEXT, newest_at TIMESTAMPTZ) AS $$
  SELECT cm.channel_id, u.newest_at
  FROM chat_channel_members cm
  JOIN chat_channels c ON c.id = cm.channel_id AND c.archived_at IS NULL
  CROSS JOIN LATERAL (
    SELECT max(m.created_at) AS newest_at
    FROM chat_messages m
    WHERE m.channel_id = cm.channel_id
      AND m.thread_root_id IS NULL
      AND m.deleted_at IS NULL
      AND m.system_subtype IS NULL
      AND m.created_at > COALESCE(cm.last_read_at, cm.joined_at)
      AND m.author_member_id IS DISTINCT FROM cm.member_id
  ) u
  WHERE cm.member_id = p_member
    AND cm.left_at IS NULL
    AND u.newest_at IS NOT NULL
  ORDER BY u.newest_at DESC;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.chat_unread_channel_ids(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_unread_channel_ids(TEXT) TO service_role;
