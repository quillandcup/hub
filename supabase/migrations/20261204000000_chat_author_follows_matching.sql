-- A Slack user whose member match goes away (an alias deleted) kept the old member as the
-- author of their messages and reactions: the projection COALESCEd the new, null match with
-- the old one. Slack-origin rows now follow the current match; Hub-written (app) messages keep
-- their author, since Slack echoes them under the bot user. Grants carry over from the originals.
CREATE OR REPLACE FUNCTION public.project_slack_chat_messages(
  from_date TIMESTAMPTZ,
  to_date TIMESTAMPTZ,
  user_member_map JSONB
) RETURNS JSONB AS $$
DECLARE
  message_count INTEGER;
  reaction_count INTEGER;
BEGIN
  WITH upserted AS (
    INSERT INTO chat_messages (
      channel_id, author_member_id, origin, slack_ts, has_files, created_at, edited_at, deleted_at
    )
    SELECT
      cc.id,
      CASE WHEN user_member_map ? m.user_id
                AND EXISTS (SELECT 1 FROM members mm WHERE mm.id = (user_member_map->>m.user_id)::uuid)
           THEN (user_member_map->>m.user_id)::uuid END,
      'slack',
      m.message_ts,
      (m.files IS NOT NULL AND m.files <> 'null'::jsonb),
      m.occurred_at,
      m.edited_at,
      m.deleted_at
    FROM bronze.slack_messages m
    JOIN chat_channels cc ON cc.slack_channel_id = m.channel_id AND NOT cc.bridge_disabled
    WHERE m.occurred_at >= from_date AND m.occurred_at <= to_date
    ON CONFLICT (channel_id, slack_ts) DO UPDATE SET
      author_member_id = CASE WHEN chat_messages.origin = 'app' THEN chat_messages.author_member_id ELSE EXCLUDED.author_member_id END,
      has_files        = EXCLUDED.has_files,
      edited_at        = EXCLUDED.edited_at,
      deleted_at       = EXCLUDED.deleted_at
    RETURNING 1
  )
  SELECT count(*) INTO message_count FROM upserted;

  INSERT INTO chat_message_contents (message_id, body, blocks, attachments)
  SELECT
    cm.id,
    COALESCE(m.text, ''),
    m.raw_payload->'blocks',
    m.raw_payload->'attachments'
  FROM bronze.slack_messages m
  JOIN chat_channels cc ON cc.slack_channel_id = m.channel_id AND NOT cc.bridge_disabled
  JOIN chat_messages cm ON cm.channel_id = cc.id AND cm.slack_ts = m.message_ts
  WHERE m.occurred_at >= from_date AND m.occurred_at <= to_date
  ON CONFLICT (message_id) DO UPDATE SET
    body        = EXCLUDED.body,
    blocks      = EXCLUDED.blocks,
    attachments = EXCLUDED.attachments;

  -- Replies point at their thread root (when we have it).
  UPDATE chat_messages r
  SET thread_root_id = root.id
  FROM bronze.slack_messages m, chat_channels cc, chat_messages root
  WHERE m.occurred_at >= from_date AND m.occurred_at <= to_date
    AND COALESCE(m.thread_ts, '') <> '' AND m.thread_ts <> m.message_ts
    AND cc.slack_channel_id = m.channel_id
    AND r.channel_id = cc.id AND r.slack_ts = m.message_ts
    AND root.channel_id = cc.id AND root.slack_ts = m.thread_ts
    AND r.thread_root_id IS DISTINCT FROM root.id;

  -- Reply counts for every root touched by this window, whichever window the root is in.
  UPDATE chat_messages root
  SET reply_count = s.n, last_reply_at = s.last_at
  FROM (
    SELECT t.thread_root_id AS id,
           count(*) FILTER (WHERE t.deleted_at IS NULL) AS n,
           max(t.created_at) FILTER (WHERE t.deleted_at IS NULL) AS last_at
    FROM chat_messages t
    WHERE t.thread_root_id IN (
      SELECT x.thread_root_id FROM chat_messages x
      WHERE x.thread_root_id IS NOT NULL AND x.created_at >= from_date AND x.created_at <= to_date
    )
    GROUP BY t.thread_root_id
  ) s
  WHERE root.id = s.id
    AND (root.reply_count IS DISTINCT FROM s.n OR root.last_reply_at IS DISTINCT FROM s.last_at);

  WITH upserted AS (
    INSERT INTO chat_reactions (message_id, member_id, slack_user_id, emoji, created_at, deleted_at)
    SELECT
      cm.id,
      CASE WHEN user_member_map ? r.user_id
                AND EXISTS (SELECT 1 FROM members mm WHERE mm.id = (user_member_map->>r.user_id)::uuid)
           THEN (user_member_map->>r.user_id)::uuid END,
      r.user_id,
      r.reaction,
      r.occurred_at,
      r.deleted_at
    FROM bronze.slack_reactions r
    JOIN chat_channels cc ON cc.slack_channel_id = r.channel_id AND NOT cc.bridge_disabled
    JOIN chat_messages cm ON cm.channel_id = cc.id AND cm.slack_ts = r.message_ts
    WHERE r.occurred_at >= from_date AND r.occurred_at <= to_date
    ON CONFLICT (message_id, emoji, slack_user_id) WHERE slack_user_id IS NOT NULL DO UPDATE SET
      member_id  = EXCLUDED.member_id,
      deleted_at = EXCLUDED.deleted_at
    RETURNING 1
  )
  SELECT count(*) INTO reaction_count FROM upserted;

  RETURN jsonb_build_object('messages', message_count, 'reactions', reaction_count);
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE OR REPLACE FUNCTION public.project_slack_chat_message(p_channel_id TEXT, p_message_ts TEXT) RETURNS JSONB AS $$
DECLARE
  v_channel UUID;
  v_message UUID;
  v_in_bronze BOOLEAN := true;
  v_thread_ts TEXT;
  v_root UUID;
BEGIN
  SELECT id INTO v_channel FROM chat_channels WHERE slack_channel_id = p_channel_id AND NOT bridge_disabled;
  IF v_channel IS NULL THEN
    RETURN jsonb_build_object('projected', false);
  END IF;

  INSERT INTO chat_messages (channel_id, author_member_id, origin, slack_ts, has_files, created_at, edited_at, deleted_at)
  SELECT v_channel, a.member_id, 'slack', m.message_ts,
         (m.files IS NOT NULL AND m.files <> 'null'::jsonb), m.occurred_at, m.edited_at, m.deleted_at
  FROM bronze.slack_messages m
  LEFT JOIN chat_slack_authors a ON a.slack_user_id = m.user_id
  WHERE m.channel_id = p_channel_id AND m.message_ts = p_message_ts
  ON CONFLICT (channel_id, slack_ts) DO UPDATE SET
    author_member_id = CASE WHEN chat_messages.origin = 'app' THEN chat_messages.author_member_id ELSE EXCLUDED.author_member_id END,
    has_files        = EXCLUDED.has_files,
    edited_at        = EXCLUDED.edited_at,
    deleted_at       = EXCLUDED.deleted_at
  RETURNING id INTO v_message;

  -- Bronze doesn't have it. The chat may still know it (a message posted from the Hub through the
  -- bot isn't kept in Bronze): then its reactions are still worth projecting. Otherwise nothing to do.
  IF v_message IS NULL THEN
    v_in_bronze := false;
    SELECT id INTO v_message FROM chat_messages WHERE channel_id = v_channel AND slack_ts = p_message_ts;
    IF v_message IS NULL THEN
      RETURN jsonb_build_object('projected', false);
    END IF;
  END IF;

  IF v_in_bronze THEN
    INSERT INTO chat_message_contents (message_id, body, blocks, attachments)
    SELECT v_message, COALESCE(m.text, ''), m.raw_payload->'blocks', m.raw_payload->'attachments'
    FROM bronze.slack_messages m
    WHERE m.channel_id = p_channel_id AND m.message_ts = p_message_ts
    ON CONFLICT (message_id) DO UPDATE SET
      body = EXCLUDED.body, blocks = EXCLUDED.blocks, attachments = EXCLUDED.attachments;

    -- Threads: a reply points at its root; a root adopts replies that arrived before it.
    SELECT NULLIF(m.thread_ts, '') INTO v_thread_ts
    FROM bronze.slack_messages m WHERE m.channel_id = p_channel_id AND m.message_ts = p_message_ts;

    IF v_thread_ts IS NOT NULL AND v_thread_ts <> p_message_ts THEN
      SELECT id INTO v_root FROM chat_messages WHERE channel_id = v_channel AND slack_ts = v_thread_ts;
      UPDATE chat_messages SET thread_root_id = v_root WHERE id = v_message AND thread_root_id IS DISTINCT FROM v_root;
    ELSE
      v_root := v_message;
      UPDATE chat_messages r SET thread_root_id = v_message
      FROM bronze.slack_messages b
      WHERE b.channel_id = p_channel_id AND b.thread_ts = p_message_ts AND b.message_ts <> b.thread_ts
        AND r.channel_id = v_channel AND r.slack_ts = b.message_ts AND r.thread_root_id IS DISTINCT FROM v_message;
    END IF;

    IF v_root IS NOT NULL THEN
      UPDATE chat_messages root
      SET reply_count = s.n, last_reply_at = s.last_at
      FROM (
        SELECT count(*) FILTER (WHERE t.deleted_at IS NULL) AS n,
               max(t.created_at) FILTER (WHERE t.deleted_at IS NULL) AS last_at
        FROM chat_messages t WHERE t.thread_root_id = v_root
      ) s
      WHERE root.id = v_root AND (root.reply_count IS DISTINCT FROM s.n OR root.last_reply_at IS DISTINCT FROM s.last_at);
    END IF;
  END IF;

  INSERT INTO chat_reactions (message_id, member_id, slack_user_id, emoji, created_at, deleted_at)
  SELECT v_message, a.member_id, r.user_id, r.reaction, r.occurred_at, r.deleted_at
  FROM bronze.slack_reactions r
  LEFT JOIN chat_slack_authors a ON a.slack_user_id = r.user_id
  WHERE r.channel_id = p_channel_id AND r.message_ts = p_message_ts
  ON CONFLICT (message_id, emoji, slack_user_id) WHERE slack_user_id IS NOT NULL DO UPDATE SET
    member_id  = EXCLUDED.member_id,
    deleted_at = EXCLUDED.deleted_at;

  RETURN jsonb_build_object('projected', true);
END;
$$ LANGUAGE plpgsql SET search_path = public;
