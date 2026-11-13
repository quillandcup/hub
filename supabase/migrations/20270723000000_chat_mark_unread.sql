-- Slack's "Mark unread": move the caller's own read marker back to just before a message, so that
-- message and everything after it counts as unread again. chat_mark_read only moves forward; this is
-- the one way back. Only the caller's own row, only backward (a message already after the marker is
-- unread already: nothing moves), top-level live messages only (unread counts skip replies).
-- Returns the caller's marker afterwards, or null when the caller is not in the conversation or the
-- message is not a live top-level message of it.
set lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.chat_mark_unread(p_channel_id text, p_message_id text)
 RETURNS timestamptz
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_member text := (SELECT current_member_id());
  v_created timestamptz;
  v_marker timestamptz;
BEGIN
  IF v_member IS NULL THEN RETURN NULL; END IF;

  SELECT m.created_at INTO v_created
  FROM chat_messages m
  WHERE m.id = p_message_id AND m.channel_id = p_channel_id AND m.thread_root_id IS NULL AND m.deleted_at IS NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;

  UPDATE chat_channel_members
  SET last_read_at = v_created - interval '1 microsecond'
  WHERE channel_id = p_channel_id AND member_id = v_member AND left_at IS NULL
    AND COALESCE(last_read_at, joined_at) >= v_created;

  SELECT COALESCE(last_read_at, joined_at) INTO v_marker
  FROM chat_channel_members
  WHERE channel_id = p_channel_id AND member_id = v_member AND left_at IS NULL;
  RETURN v_marker;
END;
$function$;

REVOKE ALL ON FUNCTION public.chat_mark_unread(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_mark_unread(text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.chat_mark_unread(text, text) IS 'Moves the caller''s own read marker back to just before a message (Mark unread). Backward only; chat_mark_read moves it forward.';

NOTIFY pgrst, 'reload schema';
