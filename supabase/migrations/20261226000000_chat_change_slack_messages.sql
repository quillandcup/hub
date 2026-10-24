-- Editing, deleting and removing the attachments of a message you wrote in Slack itself, from the Hub.
-- Until now chat_edit_message / chat_delete_message / chat_delete_file only took a message written in the
-- Hub (origin = 'app'). A message written in Slack is the member's too when the chat matched it to them
-- (author_member_id); the server action changes it in Slack first with their own token, then calls these.
-- Notices Slack posts itself (system_subtype) are nobody's to edit or delete. Otherwise identical to the
-- versions in 20261215000000_short_ids_tier1.sql (the latest).

CREATE OR REPLACE FUNCTION public.chat_delete_file(p_message_id text, p_file_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_member text := (SELECT current_member_id());
  v_message chat_messages%ROWTYPE;
BEGIN
  IF v_member IS NULL THEN
    RAISE EXCEPTION 'chat_delete: no_member';
  END IF;
  SELECT * INTO v_message FROM chat_messages WHERE id = p_message_id FOR UPDATE;
  IF NOT FOUND OR v_message.system_subtype IS NOT NULL OR v_message.author_member_id IS DISTINCT FROM v_member OR v_message.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'chat_delete: not_yours';
  END IF;

  UPDATE chat_message_contents
  SET files = NULLIF((SELECT COALESCE(jsonb_agg(f), '[]'::jsonb) FROM jsonb_array_elements(files) f WHERE f->>'id' IS DISTINCT FROM p_file_id), '[]'::jsonb)
  WHERE message_id = p_message_id AND jsonb_typeof(files) = 'array';
END;
$function$;

CREATE OR REPLACE FUNCTION public.chat_delete_message(p_message_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_member text := (SELECT current_member_id());
  v_message chat_messages%ROWTYPE;
BEGIN
  IF v_member IS NULL THEN
    RAISE EXCEPTION 'chat_delete: no_member';
  END IF;
  SELECT * INTO v_message FROM chat_messages WHERE id = p_message_id FOR UPDATE;
  IF NOT FOUND OR v_message.system_subtype IS NOT NULL OR v_message.author_member_id IS DISTINCT FROM v_member THEN
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
$function$;

CREATE OR REPLACE FUNCTION public.chat_edit_message(p_message_id text, p_body text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_member text := (SELECT current_member_id());
  v_message chat_messages%ROWTYPE;
  v_archived TIMESTAMPTZ;
  -- btrim alone trims only spaces, so a message ending in a newline would keep it.
  v_body TEXT := btrim(COALESCE(p_body, ''), E' \t\r\n');
BEGIN
  IF v_member IS NULL THEN
    RAISE EXCEPTION 'chat_edit: no_member';
  END IF;
  SELECT * INTO v_message FROM chat_messages WHERE id = p_message_id FOR UPDATE;
  IF NOT FOUND OR v_message.system_subtype IS NOT NULL OR v_message.author_member_id IS DISTINCT FROM v_member OR v_message.deleted_at IS NOT NULL THEN
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
$function$;
