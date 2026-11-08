-- Sharing a lesson video as a reply in a thread (and so into a direct message's thread): chat_post_shared_video gets a thread
-- root argument. Expand, not contract: the four-argument function stays (the code live when this ships still calls it)
-- and now just calls the new one with no thread, so the checks live in one place. The new argument has no default, so a call with
-- four named arguments can only mean the old function and PostgREST never sees an ambiguous pair. Drop the old one in a
-- later change, once nothing calls it (docs/TODO.md, "Chat: Watch Videos In The Conversation").
set lock_timeout = '5s';

CREATE FUNCTION public.chat_post_shared_video(p_channel_id text, p_body text, p_lesson_id text, p_open_to_channel boolean, p_thread_root_id text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_admin boolean := COALESCE((SELECT public.is_admin()), false);
  v_lesson public.course_lessons%ROWTYPE;
  v_course public.courses%ROWTYPE;
  v_id text;
BEGIN
  IF (SELECT public.current_member_id()) IS NULL THEN
    RAISE EXCEPTION 'chat_post: no_member';
  END IF;

  SELECT * INTO v_lesson FROM public.course_lessons WHERE id = p_lesson_id;
  IF FOUND THEN
    SELECT * INTO v_course FROM public.courses WHERE id = v_lesson.course_id;
  END IF;
  IF NOT FOUND OR v_lesson.video_id IS NULL
     OR NOT (v_admin OR (v_lesson.state = 'open' AND NOT v_course.is_draft AND public.has_course_access(v_course.id))) THEN
    RAISE EXCEPTION 'chat_post: bad_video';
  END IF;
  IF p_open_to_channel AND NOT v_admin THEN
    RAISE EXCEPTION 'chat_post: not_allowed';
  END IF;

  -- The usual checks (in the conversation, open, a valid thread, text length) and the insert.
  v_id := public.chat_post_message(p_channel_id, p_body, p_thread_root_id, NULL::jsonb);
  INSERT INTO public.chat_message_videos (message_id, lesson_id, open_to_channel) VALUES (v_id, p_lesson_id, p_open_to_channel);
  RETURN v_id;
END;
$function$;

COMMENT ON FUNCTION public.chat_post_shared_video(text, text, text, boolean, text) IS
  'Posts a message (or a thread reply) that shares a course lesson''s video, and records the share, in one transaction. Checks the sharer can open the lesson (admins any); only an admin can open it to the channel.';

REVOKE ALL ON FUNCTION public.chat_post_shared_video(text, text, text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_post_shared_video(text, text, text, boolean, text) TO authenticated, service_role;

-- The old form, now a thin call to the new one.
CREATE OR REPLACE FUNCTION public.chat_post_shared_video(p_channel_id text, p_body text, p_lesson_id text, p_open_to_channel boolean DEFAULT false)
 RETURNS text
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.chat_post_shared_video(p_channel_id, p_body, p_lesson_id, p_open_to_channel, NULL::text);
$function$;

NOTIFY pgrst, 'reload schema';
