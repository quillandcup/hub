-- Posting from the Hub to bridged Slack conversations, phase 3 of docs/SLACK_BRIDGED_CHAT.md.
--
-- The outbox: a member's message is written to chat_messages first (origin 'app',
-- slack_sync_status 'pending', slack_ts null), then the server posts it to Slack as the bot with
-- the member's name and avatar and stores the ts it gets back ('sent'). A failed post stays
-- 'failed' (or 'pending') and is retried by the nightly chat run.
--
--   chat_post_message(channel, body, thread_root)  the caller's own post (SECURITY DEFINER, bound
--                                                   to current_member_id(); members have no INSERT)
--   chat_mark_message_sent / _failed               service role: the outbox's second step
--   chat_adopt_posted_message (trigger on Bronze)  Slack's event for our own post carries our
--                                                   message id in its metadata: link it to the row
--                                                   instead of letting the projection add a copy
--
-- Guarded so the migration can be re-run.

ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS slack_sync_status TEXT CHECK (slack_sync_status IN ('pending', 'sent', 'failed')),
  ADD COLUMN IF NOT EXISTS posted_via TEXT CHECK (posted_via IN ('user_token', 'bot'));

COMMENT ON COLUMN public.chat_messages.slack_sync_status IS
  'App-origin messages only (the outbox): pending until Slack accepts the post, then sent, or failed. Null for Slack-origin rows.';
COMMENT ON COLUMN public.chat_messages.posted_via IS
  'App-origin messages only: bot (the bot posts with the member''s name and avatar) or user_token (the member''s own connected Slack token).';

-- The nightly retry looks for these.
CREATE INDEX IF NOT EXISTS chat_messages_unsent_idx ON public.chat_messages (created_at)
  WHERE origin = 'app' AND slack_sync_status IN ('pending', 'failed');

------------------------------------------------------------------------------------------------
-- The caller posts. Errors are 'chat_post: <reason>' so the app can say something useful.
------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chat_post_message(
  p_channel_id UUID,
  p_body TEXT,
  p_thread_root_id UUID DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_member UUID := (SELECT current_member_id());
  v_channel chat_channels%ROWTYPE;
  -- btrim alone trims only spaces, so a message ending in a newline would keep it.
  v_body TEXT := btrim(COALESCE(p_body, ''), E' \t\r\n');
  v_root chat_messages%ROWTYPE;
  v_id UUID;
BEGIN
  IF v_member IS NULL THEN
    RAISE EXCEPTION 'chat_post: no_member';
  END IF;

  SELECT * INTO v_channel FROM chat_channels WHERE id = p_channel_id;
  IF NOT FOUND OR NOT chat_is_channel_member(p_channel_id) THEN
    RAISE EXCEPTION 'chat_post: not_in_channel';
  END IF;
  IF v_channel.bridge_mode <> 'bridged' OR v_channel.bridge_disabled OR v_channel.bridge_status <> 'ok'
     OR v_channel.slack_channel_id IS NULL THEN
    RAISE EXCEPTION 'chat_post: not_bridged';
  END IF;
  IF v_channel.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'chat_post: archived';
  END IF;
  IF v_body = '' THEN
    RAISE EXCEPTION 'chat_post: empty';
  END IF;
  IF char_length(v_body) > 4000 THEN
    RAISE EXCEPTION 'chat_post: too_long';
  END IF;

  IF p_thread_root_id IS NOT NULL THEN
    SELECT * INTO v_root FROM chat_messages WHERE id = p_thread_root_id AND channel_id = p_channel_id;
    -- One level of threading, like Slack; and the root has to exist in Slack to be replied to.
    IF NOT FOUND OR v_root.thread_root_id IS NOT NULL OR v_root.deleted_at IS NOT NULL OR v_root.slack_ts IS NULL THEN
      RAISE EXCEPTION 'chat_post: bad_thread';
    END IF;
  END IF;

  INSERT INTO chat_messages (channel_id, author_member_id, thread_root_id, origin, created_at, slack_sync_status, posted_via)
  VALUES (p_channel_id, v_member, p_thread_root_id, 'app', now(), 'pending', 'bot')
  RETURNING id INTO v_id;

  INSERT INTO chat_message_contents (message_id, body) VALUES (v_id, v_body);

  IF p_thread_root_id IS NOT NULL THEN
    UPDATE chat_messages SET reply_count = reply_count + 1, last_reply_at = now() WHERE id = p_thread_root_id;
  END IF;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.chat_post_message(UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_post_message(UUID, TEXT, UUID) TO authenticated, service_role;

------------------------------------------------------------------------------------------------
-- Outbox, second step (service role). Slack accepted the post and gave us its ts. If Slack's
-- event for it already reached the projection without metadata we could match on, that left a
-- copy under the same ts: fold it into our row (its replies, then the copy itself).
------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chat_mark_message_sent(p_message_id UUID, p_slack_ts TEXT) RETURNS VOID AS $$
DECLARE
  v_msg chat_messages%ROWTYPE;
  v_copy UUID;
  v_root UUID;
BEGIN
  SELECT * INTO v_msg FROM chat_messages WHERE id = p_message_id AND origin = 'app' FOR UPDATE;
  IF NOT FOUND OR v_msg.slack_sync_status = 'sent' THEN
    RETURN;
  END IF;

  SELECT id INTO v_copy FROM chat_messages
  WHERE channel_id = v_msg.channel_id AND slack_ts = p_slack_ts AND id <> p_message_id;
  IF v_copy IS NOT NULL THEN
    UPDATE chat_messages SET thread_root_id = p_message_id WHERE thread_root_id = v_copy;
    UPDATE chat_messages SET reply_count = (SELECT reply_count FROM chat_messages WHERE id = v_copy)
      WHERE id = p_message_id AND v_msg.thread_root_id IS NULL;
    DELETE FROM chat_messages WHERE id = v_copy;
  END IF;

  UPDATE chat_messages SET slack_ts = p_slack_ts, slack_sync_status = 'sent' WHERE id = p_message_id;

  v_root := v_msg.thread_root_id;
  IF v_root IS NOT NULL AND v_copy IS NOT NULL THEN
    UPDATE chat_messages root
    SET reply_count = s.n, last_reply_at = s.last_at
    FROM (
      SELECT count(*) FILTER (WHERE t.deleted_at IS NULL) AS n,
             max(t.created_at) FILTER (WHERE t.deleted_at IS NULL) AS last_at
      FROM chat_messages t WHERE t.thread_root_id = v_root
    ) s
    WHERE root.id = v_root;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.chat_mark_message_failed(p_message_id UUID) RETURNS VOID AS $$
  UPDATE chat_messages SET slack_sync_status = 'failed'
  WHERE id = p_message_id AND origin = 'app' AND slack_sync_status = 'pending';
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.chat_mark_message_sent(UUID, TEXT), public.chat_mark_message_failed(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_mark_message_sent(UUID, TEXT), public.chat_mark_message_failed(UUID) TO service_role;

------------------------------------------------------------------------------------------------
-- Loop prevention. Every post carries metadata { event_type: 'hub_message', event_payload:
-- { app_message_id } }, and Slack's event for it lands in Bronze with that metadata. Link it to
-- the app row here, before the projection reads Bronze, so the projection updates that row
-- (same channel + ts) instead of adding a second one.
------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chat_adopt_posted_message() RETURNS trigger AS $$
BEGIN
  UPDATE chat_messages cm
  SET slack_ts = NEW.message_ts, slack_sync_status = 'sent'
  FROM chat_channels cc
  WHERE cc.slack_channel_id = NEW.channel_id
    AND cm.channel_id = cc.id
    AND cm.origin = 'app'
    AND cm.slack_ts IS NULL
    AND cm.id::text = NEW.raw_payload->'metadata'->'event_payload'->>'app_message_id';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.chat_adopt_posted_message() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS chat_adopt_posted_message ON bronze.slack_messages;
CREATE TRIGGER chat_adopt_posted_message
  AFTER INSERT OR UPDATE OF raw_payload ON bronze.slack_messages
  FOR EACH ROW
  WHEN (NEW.raw_payload->'metadata'->>'event_type' = 'hub_message')
  EXECUTE FUNCTION public.chat_adopt_posted_message();
