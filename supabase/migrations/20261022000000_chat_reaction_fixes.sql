-- Two reaction fixes for the Hub/Slack bridge.
--
-- 1. project_slack_chat_message (the webhook's per-event projection) gave up when Bronze had no row
--    for the message, so Slack reactions on a message posted from the Hub never reached the chat.
--    A Hub post made through the bot arrives as a `bot_message`, which Bronze doesn't keep, so there
--    is no Bronze row, but the chat row exists (the Hub wrote it). It now projects the reactions of
--    any message the chat knows by (channel, ts), and does the rest (content, threads) only when
--    Bronze has the message. Identical to 20261010000000_chat_mirror.sql otherwise (the latest
--    version of this function).
--
-- 2. chat_toggle_reaction treated only the Hub's own reaction row as "mine". A reaction the member
--    made in Slack is a Slack-keyed row, so pressing its chip added a second (Hub) row instead of
--    taking the reaction away. A live Slack-keyed reaction of the caller's now counts as theirs:
--    toggling soft-deletes it (and any Hub row) and returns false, and the server then removes it
--    in Slack as them. Otherwise identical to 20261020000000_chat_reactions.sql.

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
    author_member_id = COALESCE(EXCLUDED.author_member_id, chat_messages.author_member_id),
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
    member_id  = COALESCE(EXCLUDED.member_id, chat_reactions.member_id),
    deleted_at = EXCLUDED.deleted_at;

  RETURN jsonb_build_object('projected', true);
END;
$$ LANGUAGE plpgsql SET search_path = public;

REVOKE ALL ON FUNCTION public.project_slack_chat_message(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.project_slack_chat_message(TEXT, TEXT) TO service_role;

------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chat_toggle_reaction(p_message_id UUID, p_emoji TEXT) RETURNS BOOLEAN AS $$
DECLARE
  v_member UUID := (SELECT current_member_id());
  v_channel chat_channels%ROWTYPE;
  v_message chat_messages%ROWTYPE;
  v_existing chat_reactions%ROWTYPE;
  v_has_hub_row BOOLEAN;
  v_has_live_slack BOOLEAN;
BEGIN
  IF v_member IS NULL THEN
    RAISE EXCEPTION 'chat_react: no_member';
  END IF;
  -- A Slack shortcode: lower-case letters, digits and _ + -, with an optional skin tone.
  IF p_emoji IS NULL OR p_emoji !~ '^[a-z0-9_+-]{1,64}(::skin-tone-[2-6])?$' THEN
    RAISE EXCEPTION 'chat_react: bad_emoji';
  END IF;

  SELECT * INTO v_message FROM chat_messages WHERE id = p_message_id;
  IF NOT FOUND OR v_message.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'chat_react: no_message';
  END IF;
  SELECT * INTO v_channel FROM chat_channels WHERE id = v_message.channel_id;
  -- The member's own conversations and public channels (an admin's wider read access doesn't count).
  IF NOT (v_channel.visibility = 'public' OR chat_is_channel_member(v_channel.id)) THEN
    RAISE EXCEPTION 'chat_react: no_message';
  END IF;
  IF v_channel.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'chat_react: archived';
  END IF;

  SELECT * INTO v_existing FROM chat_reactions
  WHERE message_id = p_message_id AND emoji = p_emoji AND member_id = v_member AND slack_user_id IS NULL
  FOR UPDATE;
  -- FOUND is overwritten by the next statement, so keep this answer.
  v_has_hub_row := FOUND;

  -- A reaction the member made in Slack is theirs too.
  SELECT EXISTS (
    SELECT 1 FROM chat_reactions
    WHERE message_id = p_message_id AND emoji = p_emoji AND member_id = v_member
      AND slack_user_id IS NOT NULL AND deleted_at IS NULL
  ) INTO v_has_live_slack;

  IF v_has_live_slack OR (v_has_hub_row AND v_existing.deleted_at IS NULL) THEN
    UPDATE chat_reactions SET deleted_at = now()
    WHERE message_id = p_message_id AND emoji = p_emoji AND member_id = v_member AND deleted_at IS NULL;
    RETURN false;
  END IF;

  IF NOT v_has_hub_row THEN
    INSERT INTO chat_reactions (message_id, member_id, emoji, created_at, synced_to_slack)
    VALUES (p_message_id, v_member, p_emoji, now(), false);
    RETURN true;
  END IF;
  UPDATE chat_reactions SET deleted_at = NULL, created_at = now(), synced_to_slack = false WHERE id = v_existing.id;
  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.chat_toggle_reaction(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_toggle_reaction(UUID, TEXT) TO authenticated, service_role;
