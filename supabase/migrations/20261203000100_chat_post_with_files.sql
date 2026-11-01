-- Sending files from the Hub (docs/SLACK_BRIDGED_CHAT.md, "Files"). A message may now carry files:
--
--   chat_post_message(channel, body, thread_root, files)  the 3-argument version still exists and
--     calls this one. `files` is a JSON array of 1 to 10 { id, name, mimetype, size, staged } where
--     `id` is 'pending-<uuid>' until Slack has the file and `staged` is where the bytes wait in the
--     private slack-files bucket. A message needs text or files.
--   chat_adopt_posted_file_message (trigger on Bronze)    Slack's event for a file upload can't carry
--     our message metadata, so it is matched by the Slack file ids instead (the sender stores them
--     on the app row as soon as Slack returns them).
--
-- Guarded so the migration can be re-run.

CREATE OR REPLACE FUNCTION public.chat_post_message(
  p_channel_id UUID,
  p_body TEXT,
  p_thread_root_id UUID,
  p_files JSONB
) RETURNS UUID AS $$
DECLARE
  v_member UUID := (SELECT current_member_id());
  v_channel chat_channels%ROWTYPE;
  v_body TEXT := btrim(COALESCE(p_body, ''), E' \t\r\n');
  v_root chat_messages%ROWTYPE;
  v_id UUID;
  v_has_files BOOLEAN := p_files IS NOT NULL AND jsonb_typeof(p_files) = 'array' AND jsonb_array_length(p_files) > 0;
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

  IF p_files IS NOT NULL AND (
       jsonb_typeof(p_files) <> 'array' OR jsonb_array_length(p_files) > 10
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_files) f
         WHERE jsonb_typeof(f) <> 'object' OR COALESCE(f->>'id', '') NOT LIKE 'pending-%' OR COALESCE(f->>'name', '') = ''
       )
     ) THEN
    RAISE EXCEPTION 'chat_post: bad_files';
  END IF;

  IF v_body = '' AND NOT v_has_files THEN
    RAISE EXCEPTION 'chat_post: empty';
  END IF;
  IF char_length(v_body) > 4000 THEN
    RAISE EXCEPTION 'chat_post: too_long';
  END IF;

  IF p_thread_root_id IS NOT NULL THEN
    SELECT * INTO v_root FROM chat_messages WHERE id = p_thread_root_id AND channel_id = p_channel_id;
    IF NOT FOUND OR v_root.thread_root_id IS NOT NULL OR v_root.deleted_at IS NOT NULL OR v_root.slack_ts IS NULL THEN
      RAISE EXCEPTION 'chat_post: bad_thread';
    END IF;
  END IF;

  INSERT INTO chat_messages (channel_id, author_member_id, thread_root_id, origin, created_at, slack_sync_status, posted_via, has_files)
  VALUES (p_channel_id, v_member, p_thread_root_id, 'app', now(), 'pending', 'bot', v_has_files)
  RETURNING id INTO v_id;

  INSERT INTO chat_message_contents (message_id, body, files)
  VALUES (v_id, v_body, CASE WHEN v_has_files THEN p_files END);

  IF p_thread_root_id IS NOT NULL THEN
    UPDATE chat_messages SET reply_count = reply_count + 1, last_reply_at = now() WHERE id = p_thread_root_id;
  END IF;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.chat_post_message(UUID, TEXT, UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_post_message(UUID, TEXT, UUID, JSONB) TO authenticated, service_role;

-- The old signature keeps working (text only).
CREATE OR REPLACE FUNCTION public.chat_post_message(
  p_channel_id UUID,
  p_body TEXT,
  p_thread_root_id UUID DEFAULT NULL
) RETURNS UUID AS $$
  SELECT public.chat_post_message(p_channel_id, p_body, p_thread_root_id, NULL::jsonb);
$$ LANGUAGE sql SECURITY INVOKER SET search_path = public;

REVOKE ALL ON FUNCTION public.chat_post_message(UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_post_message(UUID, TEXT, UUID) TO authenticated, service_role;

------------------------------------------------------------------------------------------------
-- Slack's event for a file upload: link it to our pending row by file id, before the projection
-- reads Bronze, so the projection updates our row (same channel + ts) instead of adding a copy.
-- Our row only has the real Slack ids once the sender stored them, so an event that wins that race
-- is folded in by chat_mark_message_sent instead.
------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chat_adopt_posted_file_message() RETURNS trigger AS $$
BEGIN
  UPDATE chat_messages cm
  SET slack_ts = NEW.message_ts, slack_sync_status = 'sent'
  FROM chat_channels cc, chat_message_contents c
  WHERE cc.slack_channel_id = NEW.channel_id
    AND cm.channel_id = cc.id
    AND cm.origin = 'app'
    AND cm.slack_ts IS NULL
    AND c.message_id = cm.id
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(c.files) ours, jsonb_array_elements(NEW.files) theirs
      WHERE ours->>'id' = theirs->>'id' AND ours->>'id' NOT LIKE 'pending-%'
    );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.chat_adopt_posted_file_message() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS chat_adopt_posted_file_message ON bronze.slack_messages;
CREATE TRIGGER chat_adopt_posted_file_message
  AFTER INSERT ON bronze.slack_messages
  FOR EACH ROW
  WHEN (NEW.files IS NOT NULL AND jsonb_typeof(NEW.files) = 'array')
  EXECUTE FUNCTION public.chat_adopt_posted_file_message();
