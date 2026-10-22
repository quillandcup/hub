-- Remove one file from the author's own Hub-written message (the "x" on an attachment). The file
-- list in chat_message_contents.files is a Local projection (the bytes stay in the private
-- slack-files bucket and Bronze), so the entry is dropped from the list. Slack is told first by the
-- app (files.delete). Only app-origin messages: Slack-origin lists are rebuilt from Bronze.

CREATE OR REPLACE FUNCTION public.chat_delete_file(p_message_id UUID, p_file_id TEXT) RETURNS VOID AS $$
DECLARE
  v_member UUID := (SELECT current_member_id());
  v_message chat_messages%ROWTYPE;
BEGIN
  IF v_member IS NULL THEN
    RAISE EXCEPTION 'chat_delete: no_member';
  END IF;
  SELECT * INTO v_message FROM chat_messages WHERE id = p_message_id FOR UPDATE;
  IF NOT FOUND OR v_message.origin <> 'app' OR v_message.author_member_id IS DISTINCT FROM v_member OR v_message.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'chat_delete: not_yours';
  END IF;

  UPDATE chat_message_contents
  SET files = NULLIF((SELECT COALESCE(jsonb_agg(f), '[]'::jsonb) FROM jsonb_array_elements(files) f WHERE f->>'id' IS DISTINCT FROM p_file_id), '[]'::jsonb)
  WHERE message_id = p_message_id AND jsonb_typeof(files) = 'array';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.chat_delete_file(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_delete_file(UUID, TEXT) TO authenticated, service_role;
