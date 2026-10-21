-- Editing and deleting your own messages from the Hub, phase 3 of docs/SLACK_BRIDGED_CHAT.md.
--
-- Only messages written in the Hub (origin 'app') and only by their author, like posting. The
-- server changes the message in Slack first (as whoever posted it: the member's own token or the
-- bot, see chat_messages.posted_via) and then calls these, so the Hub never says something Slack
-- doesn't. Both are SECURITY DEFINER and bound to current_member_id(): members have no UPDATE on
-- chat_messages or chat_message_contents.
--
--   chat_edit_message(message, body)   replace the text, stamp edited_at
--   chat_delete_message(message)       soft delete (deleted_at): the text is kept, shown as a
--                                      tombstone, readable only through break-glass (see Deletes)

CREATE OR REPLACE FUNCTION public.chat_edit_message(p_message_id UUID, p_body TEXT) RETURNS VOID AS $$
DECLARE
  v_member UUID := (SELECT current_member_id());
  v_message chat_messages%ROWTYPE;
  v_archived TIMESTAMPTZ;
  -- btrim alone trims only spaces, so a message ending in a newline would keep it.
  v_body TEXT := btrim(COALESCE(p_body, ''), E' \t\r\n');
BEGIN
  IF v_member IS NULL THEN
    RAISE EXCEPTION 'chat_edit: no_member';
  END IF;
  SELECT * INTO v_message FROM chat_messages WHERE id = p_message_id FOR UPDATE;
  IF NOT FOUND OR v_message.origin <> 'app' OR v_message.author_member_id IS DISTINCT FROM v_member OR v_message.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'chat_edit: not_yours';
  END IF;
  SELECT archived_at INTO v_archived FROM chat_channels WHERE id = v_message.channel_id;
  IF v_archived IS NOT NULL THEN
    RAISE EXCEPTION 'chat_edit: archived';
  END IF;
  IF v_body = '' THEN
    RAISE EXCEPTION 'chat_edit: empty';
  END IF;
  IF char_length(v_body) > 4000 THEN
    RAISE EXCEPTION 'chat_edit: too_long';
  END IF;

  UPDATE chat_message_contents SET body = v_body WHERE message_id = p_message_id;
  UPDATE chat_messages SET edited_at = now() WHERE id = p_message_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.chat_delete_message(p_message_id UUID) RETURNS VOID AS $$
DECLARE
  v_member UUID := (SELECT current_member_id());
  v_message chat_messages%ROWTYPE;
BEGIN
  IF v_member IS NULL THEN
    RAISE EXCEPTION 'chat_delete: no_member';
  END IF;
  SELECT * INTO v_message FROM chat_messages WHERE id = p_message_id FOR UPDATE;
  IF NOT FOUND OR v_message.origin <> 'app' OR v_message.author_member_id IS DISTINCT FROM v_member THEN
    RAISE EXCEPTION 'chat_delete: not_yours';
  END IF;
  IF v_message.deleted_at IS NOT NULL THEN
    RETURN;
  END IF;

  UPDATE chat_messages SET deleted_at = now() WHERE id = p_message_id;

  -- A deleted reply no longer counts toward its thread.
  IF v_message.thread_root_id IS NOT NULL THEN
    UPDATE chat_messages root
    SET reply_count = s.n, last_reply_at = s.last_at
    FROM (
      SELECT count(*) FILTER (WHERE t.deleted_at IS NULL) AS n,
             max(t.created_at) FILTER (WHERE t.deleted_at IS NULL) AS last_at
      FROM chat_messages t WHERE t.thread_root_id = v_message.thread_root_id
    ) s
    WHERE root.id = v_message.thread_root_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.chat_edit_message(UUID, TEXT), public.chat_delete_message(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_edit_message(UUID, TEXT), public.chat_delete_message(UUID) TO authenticated, service_role;
