-- Direct messages between two members, written and read in the Hub only (behind the `chat_dms` feature).
-- A Hub DM is a chat_channels row with kind 'dm', bridge_mode 'app_only' (no Slack channel, nothing is
-- sent to Slack), private and restricted (staff need break-glass for the text, the constraint
-- chat_channels_dms_restricted). Slack's own 1:1 DMs are still never bridged.
set lock_timeout = '5s';

-- One DM per pair of members: the two ids sorted and joined, so finding or creating it is race-safe.
ALTER TABLE public.chat_channels ADD COLUMN IF NOT EXISTS dm_key text;
CREATE UNIQUE INDEX IF NOT EXISTS chat_channels_dm_key_key ON public.chat_channels (dm_key);
COMMENT ON COLUMN public.chat_channels.dm_key IS
  'Hub direct messages only: the two participants'' member ids, sorted and joined with a colon. Unique, so a pair of members has one DM.';

INSERT INTO feature_flags (feature_key, enabled_globally)
VALUES ('chat_dms', false)
ON CONFLICT (feature_key) DO NOTHING;

-- The caller's DM with another member, created on first use. Only touches the caller's own pair.
CREATE OR REPLACE FUNCTION public.chat_find_or_create_dm(p_other_member_id text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_member text := (SELECT current_member_id());
  v_key text;
  v_id text;
BEGIN
  IF v_member IS NULL THEN
    RAISE EXCEPTION 'chat_dm: no_member';
  END IF;
  IF p_other_member_id IS NULL OR p_other_member_id = v_member
     OR NOT EXISTS (SELECT 1 FROM members WHERE id = p_other_member_id) THEN
    RAISE EXCEPTION 'chat_dm: bad_member';
  END IF;

  v_key := least(v_member, p_other_member_id) || ':' || greatest(v_member, p_other_member_id);

  INSERT INTO chat_channels (kind, bridge_mode, visibility, restricted, dm_key)
  VALUES ('dm', 'app_only', 'private', true, v_key)
  ON CONFLICT (dm_key) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    INSERT INTO chat_channel_members (channel_id, member_id, source)
    VALUES (v_id, v_member, 'app'), (v_id, p_other_member_id, 'app');
    RETURN v_id;
  END IF;

  SELECT id INTO v_id FROM chat_channels WHERE dm_key = v_key;
  -- Both people are in their DM again even if one was marked as left.
  UPDATE chat_channel_members SET left_at = NULL
  WHERE channel_id = v_id AND member_id IN (v_member, p_other_member_id) AND left_at IS NOT NULL;
  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.chat_find_or_create_dm(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_find_or_create_dm(text) TO authenticated, service_role;
COMMENT ON FUNCTION public.chat_find_or_create_dm(text) IS
  'The signed-in member''s direct message with another member (kind dm, app_only), created on first use. Errors: chat_dm: no_member | bad_member.';

-- chat_post_message for Hub-only conversations: no Slack channel is needed, the message is not queued
-- for Slack (slack_sync_status and posted_via stay null), a reply can go under any live message, and
-- attachments are not supported there yet. Everything else is as before.
CREATE OR REPLACE FUNCTION public.chat_post_message(p_channel_id text, p_body text, p_thread_root_id text, p_files jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_member text := (SELECT current_member_id());
  v_channel chat_channels%ROWTYPE;
  v_body TEXT := btrim(COALESCE(p_body, ''), E' \t\r\n');
  v_root chat_messages%ROWTYPE;
  v_id text;
  v_has_files BOOLEAN := p_files IS NOT NULL AND jsonb_typeof(p_files) = 'array' AND jsonb_array_length(p_files) > 0;
  v_hub_only BOOLEAN;
BEGIN
  IF v_member IS NULL THEN
    RAISE EXCEPTION 'chat_post: no_member';
  END IF;

  SELECT * INTO v_channel FROM chat_channels WHERE id = p_channel_id;
  IF NOT FOUND OR NOT chat_is_channel_member(p_channel_id) THEN
    RAISE EXCEPTION 'chat_post: not_in_channel';
  END IF;
  v_hub_only := v_channel.bridge_mode = 'app_only';
  IF NOT v_hub_only AND (v_channel.bridge_mode <> 'bridged' OR v_channel.bridge_disabled OR v_channel.bridge_status <> 'ok'
     OR v_channel.slack_channel_id IS NULL) THEN
    RAISE EXCEPTION 'chat_post: not_bridged';
  END IF;
  IF v_channel.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'chat_post: archived';
  END IF;

  IF p_files IS NOT NULL AND (
       jsonb_typeof(p_files) <> 'array' OR jsonb_array_length(p_files) > 10
       OR (v_hub_only AND jsonb_array_length(p_files) > 0)
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
    IF NOT FOUND OR v_root.thread_root_id IS NOT NULL OR v_root.deleted_at IS NOT NULL
       OR (v_root.slack_ts IS NULL AND NOT v_hub_only) THEN
      RAISE EXCEPTION 'chat_post: bad_thread';
    END IF;
  END IF;

  INSERT INTO chat_messages (channel_id, author_member_id, thread_root_id, origin, created_at, slack_sync_status, posted_via, has_files)
  VALUES (p_channel_id, v_member, p_thread_root_id, 'app', now(),
          CASE WHEN v_hub_only THEN NULL ELSE 'pending' END,
          CASE WHEN v_hub_only THEN NULL ELSE 'bot' END,
          v_has_files)
  RETURNING id INTO v_id;

  INSERT INTO chat_message_contents (message_id, body, files)
  VALUES (v_id, v_body, CASE WHEN v_has_files THEN p_files END);

  IF p_thread_root_id IS NOT NULL THEN
    UPDATE chat_messages SET reply_count = reply_count + 1, last_reply_at = now() WHERE id = p_thread_root_id;
  END IF;

  RETURN v_id;
END;
$function$;
