-- Who a thread reply was for, in member_interactions (20261212000000). Pointing every reply at the
-- thread's author made the author look like the hub of every conversation and missed the back-and-forth
-- between everyone else. A reply is now for whoever it was most likely for; Slack doesn't record that,
-- so, in order:
--   1. a reply that tags someone is for them (the mention rows say so, no thread_reply row);
--   2. if someone tagged the replier earlier in the thread and the replier hasn't posted since, it is for the
--      most recent person who did (people answer a tag later, after others have spoken);
--   3. otherwise it is for whoever spoke last (the thread's author for the first reply), skipping the
--      replier's own messages;
--   4. when that person isn't a matched member, nobody.
-- One row per reply however long the thread; no pairing of everyone in it, no distance weighting.
--
-- Only reprocess_member_interactions_atomic changes; the table is rebuilt by the next run (the nightly
-- import, or /api/process/member-interactions for a date range). Everything else in it is as it was.

CREATE OR REPLACE FUNCTION public.reprocess_member_interactions_atomic(
  from_date TIMESTAMPTZ,
  to_date TIMESTAMPTZ
) RETURNS JSONB AS $$
DECLARE
  n_thread INTEGER;
  n_dm INTEGER;
  n_reaction INTEGER;
  n_mention INTEGER;
BEGIN
  DELETE FROM member_interactions WHERE occurred_at >= from_date AND occurred_at <= to_date;

  -- A reply in a channel's thread: the replier toward whoever it was most likely for. Slack doesn't record
  -- that, so, in this order:
  --   1. a reply that tags someone is for them: the mention rows below say so, no thread_reply row here;
  --   2. if someone tagged the replier earlier in the thread and the replier hasn't posted since, it is for the
  --      most recent person who did (people answer a tag later, after others have spoken);
  --   3. otherwise it is for whoever spoke last (the thread's author for the first reply), skipping the
  --      replier's own messages (posting twice in a row is still for the same person);
  --   4. when that person isn't a matched member, nobody: it isn't attributed to someone further back.
  -- One row per reply, whatever the thread's length. The thread's own root always comes before its replies, even
  -- when they share a timestamp.
  WITH replies AS (
    SELECT r.id, r.channel_id, r.thread_root_id, r.author_member_id, r.created_at, c.visibility
    FROM chat_messages r
    JOIN chat_channels c ON c.id = r.channel_id AND c.kind = 'channel'
    WHERE r.thread_root_id IS NOT NULL
      AND r.created_at >= from_date AND r.created_at <= to_date
      AND r.deleted_at IS NULL
      AND r.author_member_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM chat_message_contents ct WHERE ct.message_id = r.id AND ct.body ~ '<@[UW][A-Z0-9]+'
      )
  ),
  targeted AS (
    SELECT r.*, COALESCE(tagger.member_id, prev.member_id) AS target
    FROM replies r
    LEFT JOIN LATERAL (
      SELECT m.author_member_id AS member_id
      FROM chat_messages m
      JOIN chat_message_contents ct ON ct.message_id = m.id
      WHERE (m.id = r.thread_root_id OR m.thread_root_id = r.thread_root_id)
        AND (m.id = r.thread_root_id OR m.created_at < r.created_at)
        AND m.deleted_at IS NULL
        AND m.author_member_id IS NOT NULL AND m.author_member_id <> r.author_member_id
        AND EXISTS (
          SELECT 1 FROM chat_slack_authors a
          WHERE a.member_id = r.author_member_id AND ct.body ~ ('<@' || a.slack_user_id || '[>|]')
        )
        AND NOT EXISTS (
          SELECT 1 FROM chat_messages mine
          WHERE (mine.id = r.thread_root_id OR mine.thread_root_id = r.thread_root_id)
            AND mine.author_member_id = r.author_member_id AND mine.deleted_at IS NULL
            AND mine.created_at > m.created_at AND mine.created_at < r.created_at
        )
      ORDER BY m.created_at DESC
      LIMIT 1
    ) tagger ON true
    LEFT JOIN LATERAL (
      SELECT m.author_member_id AS member_id
      FROM chat_messages m
      WHERE (m.id = r.thread_root_id OR m.thread_root_id = r.thread_root_id)
        AND (m.id = r.thread_root_id OR m.created_at < r.created_at)
        AND m.deleted_at IS NULL
        AND m.author_member_id IS DISTINCT FROM r.author_member_id
      ORDER BY m.created_at DESC
      LIMIT 1
    ) prev ON true
  ),
  inserted AS (
    INSERT INTO member_interactions (member_a, member_b, kind, channel_id, message_id, occurred_at, visibility)
    SELECT t.author_member_id, t.target, 'thread_reply', t.channel_id, t.id, t.created_at,
           CASE WHEN t.visibility = 'public' THEN 'public' ELSE 'private' END
    FROM targeted t
    WHERE t.target IS NOT NULL AND t.target <> t.author_member_id
    RETURNING 1
  )
  SELECT count(*) INTO n_thread FROM inserted;

  -- A message in a DM or group DM: its author toward each of the other people in it (always private).
  WITH inserted AS (
    INSERT INTO member_interactions (member_a, member_b, kind, channel_id, message_id, occurred_at, visibility)
    SELECT m.author_member_id, cm.member_id, 'dm', m.channel_id, m.id, m.created_at, 'private'
    FROM chat_messages m
    JOIN chat_channels c ON c.id = m.channel_id AND c.kind IN ('dm', 'group_dm')
    JOIN chat_channel_members cm ON cm.channel_id = m.channel_id AND cm.left_at IS NULL AND cm.member_id <> m.author_member_id
    WHERE m.created_at >= from_date AND m.created_at <= to_date
      AND m.deleted_at IS NULL
      AND m.author_member_id IS NOT NULL
    RETURNING 1
  )
  SELECT count(*) INTO n_dm FROM inserted;

  -- A reaction: the reactor toward the message's author. A member who reacted in Slack and in the Hub
  -- with the same emoji counts once.
  WITH inserted AS (
    INSERT INTO member_interactions (member_a, member_b, kind, channel_id, message_id, occurred_at, visibility)
    SELECT x.member_id, x.author_member_id, 'reaction', x.channel_id, x.message_id, x.created_at,
           CASE WHEN x.kind = 'channel' AND x.visibility = 'public' THEN 'public' ELSE 'private' END
    FROM (
      SELECT DISTINCT ON (r.message_id, r.emoji, r.member_id)
             r.member_id, m.author_member_id, m.channel_id, m.id AS message_id, r.created_at, c.kind, c.visibility
      FROM chat_reactions r
      JOIN chat_messages m ON m.id = r.message_id
      JOIN chat_channels c ON c.id = m.channel_id
      WHERE r.created_at >= from_date AND r.created_at <= to_date
        AND r.deleted_at IS NULL
        AND r.member_id IS NOT NULL AND m.author_member_id IS NOT NULL
        AND r.member_id <> m.author_member_id
      ORDER BY r.message_id, r.emoji, r.member_id, r.created_at
    ) x
    RETURNING 1
  )
  SELECT count(*) INTO n_reaction FROM inserted;

  -- A mention (<@U123> in the text): the writer toward each person mentioned, once per message. Reads the
  -- text only to find who is named; nothing of it is kept.
  WITH inserted AS (
    INSERT INTO member_interactions (member_a, member_b, kind, channel_id, message_id, occurred_at, visibility)
    SELECT m.author_member_id, a.member_id, 'mention', m.channel_id, m.id, m.created_at,
           CASE WHEN c.kind = 'channel' AND c.visibility = 'public' THEN 'public' ELSE 'private' END
    FROM chat_messages m
    JOIN chat_message_contents ct ON ct.message_id = m.id
    JOIN chat_channels c ON c.id = m.channel_id
    CROSS JOIN LATERAL (
      SELECT DISTINCT hit[1] AS slack_user_id FROM regexp_matches(ct.body, '<@([UW][A-Z0-9]+)', 'g') AS hit
    ) u
    JOIN chat_slack_authors a ON a.slack_user_id = u.slack_user_id
    WHERE m.created_at >= from_date AND m.created_at <= to_date
      AND m.deleted_at IS NULL
      AND m.author_member_id IS NOT NULL
      AND a.member_id <> m.author_member_id
    RETURNING 1
  )
  SELECT count(*) INTO n_mention FROM inserted;

  RETURN jsonb_build_object('thread_replies', n_thread, 'dms', n_dm, 'reactions', n_reaction, 'mentions', n_mention);
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- It reads message text (to find mentions), so service role only.
REVOKE ALL ON FUNCTION public.reprocess_member_interactions_atomic(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reprocess_member_interactions_atomic(TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;
