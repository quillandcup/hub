-- Adding files to a message you are editing (like Slack's edit box). The app uploads the files to Slack as the
-- member and edits the message with their ids first (chat.update file_ids), then calls this so the Hub's list
-- shows them at once; the pull-based import and the webhook rebuild the same list from Slack's message.
-- Only the author, never a Slack notice or a deleted message, as chat_edit_message. Appends: a file already
-- listed is not added twice.

set lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.chat_add_message_files(p_message_id text, p_files jsonb)
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
    RAISE EXCEPTION 'chat_edit: no_member';
  END IF;
  IF jsonb_typeof(p_files) IS DISTINCT FROM 'array' OR jsonb_array_length(p_files) = 0 THEN
    RAISE EXCEPTION 'chat_edit: bad_files';
  END IF;
  SELECT * INTO v_message FROM chat_messages WHERE id = p_message_id FOR UPDATE;
  IF NOT FOUND OR v_message.system_subtype IS NOT NULL OR v_message.author_member_id IS DISTINCT FROM v_member OR v_message.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'chat_edit: not_yours';
  END IF;

  UPDATE chat_message_contents
  SET files = COALESCE(files, '[]'::jsonb) || (
    SELECT COALESCE(jsonb_agg(f), '[]'::jsonb)
    FROM jsonb_array_elements(p_files) f
    WHERE NOT COALESCE(files, '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('id', f->>'id'))
  )
  WHERE message_id = p_message_id;
  UPDATE chat_messages SET has_files = true, edited_at = now() WHERE id = p_message_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.chat_add_message_files(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_add_message_files(text, jsonb) TO authenticated, service_role;
