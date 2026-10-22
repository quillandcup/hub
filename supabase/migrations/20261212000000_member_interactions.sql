-- Silver: member_interactions (docs/SLACK_BRIDGED_CHAT.md, "Silver: member_interactions"). Who talked
-- with whom, built from the chat mirror (chat_messages, chat_reactions, chat_channel_members) for the
-- member network graph, next to prickle co-attendance. It holds the relationship (who, toward whom,
-- where, when, whether in the open or in private), never what was said.
--
--   member_a   who acted (wrote, replied, reacted, mentioned)
--   member_b   who it was toward (the message's or thread's author, the person mentioned, a DM's other people)
--   kind       dm | thread_reply | reaction | mention | channel_comember
--   visibility public (a public channel) | private (a private channel, a DM or group DM): staff see
--              the counts and who, as /privacy says, and the graph can show them apart
--
-- Reprocessable from the chat tables alone: reprocess_member_interactions_atomic deletes a date range
-- and rebuilds it in one transaction (a week per call, like the other Silver rebuilds, so it stays
-- under the statement timeout). Deleted messages and reactions taken back are left out. Authors the
-- chat could not match to a member are left out (no member to attach it to).
--
-- channel_comember (sharing a conversation) is allowed by the check constraint but not built yet:
-- pairing every member of a large public channel is quadratic and says little.
--
-- Silver layer: derived, DELETE + INSERT. Service role writes, admins read.

CREATE TABLE IF NOT EXISTS public.member_interactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_a    UUID NOT NULL REFERENCES public.members (id) ON DELETE CASCADE,
  member_b    UUID NOT NULL REFERENCES public.members (id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('dm', 'thread_reply', 'reaction', 'mention', 'channel_comember')),
  channel_id  UUID REFERENCES public.chat_channels (id) ON DELETE CASCADE,
  message_id  UUID REFERENCES public.chat_messages (id) ON DELETE CASCADE,
  occurred_at TIMESTAMPTZ NOT NULL,
  visibility  TEXT NOT NULL CHECK (visibility IN ('public', 'private')),
  CONSTRAINT member_interactions_not_self CHECK (member_a <> member_b)
);

COMMENT ON TABLE public.member_interactions IS
  'SILVER: who interacted with whom in chat (a DM, a thread reply, a reaction, a mention), where and when, never what was said. Rebuilt from the chat tables by reprocess_member_interactions_atomic (DELETE + INSERT by date range). Service role writes; admins read.';

CREATE INDEX IF NOT EXISTS member_interactions_occurred_idx ON public.member_interactions (occurred_at);
CREATE INDEX IF NOT EXISTS member_interactions_a_idx ON public.member_interactions (member_a, occurred_at);
CREATE INDEX IF NOT EXISTS member_interactions_b_idx ON public.member_interactions (member_b, occurred_at);

ALTER TABLE public.member_interactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.member_interactions FROM anon, authenticated;
GRANT SELECT ON public.member_interactions TO authenticated;
GRANT ALL ON public.member_interactions TO service_role;

DROP POLICY IF EXISTS "Admins read member interactions" ON public.member_interactions;
CREATE POLICY "Admins read member interactions" ON public.member_interactions
  FOR SELECT TO authenticated USING ((SELECT is_admin()));

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

  -- A reply in a channel's thread: the replier toward the thread's author.
  WITH inserted AS (
    INSERT INTO member_interactions (member_a, member_b, kind, channel_id, message_id, occurred_at, visibility)
    SELECT r.author_member_id, root.author_member_id, 'thread_reply', r.channel_id, r.id, r.created_at,
           CASE WHEN c.visibility = 'public' THEN 'public' ELSE 'private' END
    FROM chat_messages r
    JOIN chat_messages root ON root.id = r.thread_root_id
    JOIN chat_channels c ON c.id = r.channel_id AND c.kind = 'channel'
    WHERE r.created_at >= from_date AND r.created_at <= to_date
      AND r.deleted_at IS NULL
      AND r.author_member_id IS NOT NULL AND root.author_member_id IS NOT NULL
      AND r.author_member_id <> root.author_member_id
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

-- The network graph's read: interactions between each pair of members since a date, counted by kind and
-- visibility, so the page never pulls the interaction rows themselves (there can be tens of thousands).
-- SECURITY INVOKER: member_interactions' RLS applies, so only admins get anything. Ordered, so a caller
-- can page through it past the API's 1000-row limit.
CREATE OR REPLACE FUNCTION public.member_interaction_pairs(p_since TIMESTAMPTZ, p_include_private BOOLEAN)
RETURNS TABLE (member_x UUID, member_y UUID, kind TEXT, visibility TEXT, n BIGINT) AS $$
  SELECT least(member_a, member_b), greatest(member_a, member_b), mi.kind, mi.visibility, count(*)
  FROM member_interactions mi
  WHERE mi.occurred_at >= p_since AND (p_include_private OR mi.visibility = 'public')
  GROUP BY 1, 2, 3, 4
  ORDER BY 1, 2, 3, 4;
$$ LANGUAGE sql STABLE SET search_path = public;

REVOKE ALL ON FUNCTION public.member_interaction_pairs(TIMESTAMPTZ, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_interaction_pairs(TIMESTAMPTZ, BOOLEAN) TO authenticated, service_role;
