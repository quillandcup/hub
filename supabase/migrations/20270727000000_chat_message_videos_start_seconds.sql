-- A lesson video shared in chat starts where the pasted lesson link said (`?t=95`), like the lesson page does.
-- Expand only: a nullable column, and a six-argument chat_post_shared_video that carries the start. The five-argument
-- function stays (the code live when this ships still calls it) and now just calls the new one with no start, so the
-- checks live in one place. The new argument has no default, so PostgREST never sees an ambiguous pair. Drop the
-- five-argument form in a later change, once nothing calls it (docs/TODO.md, "Chat video card starts at the shared timestamp").
set lock_timeout = '5s';

ALTER TABLE public.chat_message_videos
  ADD COLUMN start_seconds integer CHECK (start_seconds IS NULL OR (start_seconds > 0 AND start_seconds <= 86400));

COMMENT ON COLUMN public.chat_message_videos.start_seconds IS
  'Where the video starts for everyone who plays it, from the ?t= of the pasted lesson link; null starts from the viewer''s saved position (or the beginning).';

CREATE FUNCTION public.chat_post_shared_video(p_channel_id text, p_body text, p_lesson_id text, p_open_to_channel boolean, p_thread_root_id text, p_start_seconds integer)
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
  -- A start outside the lesson page's own range is dropped, not an error: the link still shares the video.
  IF p_start_seconds IS NOT NULL AND (p_start_seconds <= 0 OR p_start_seconds > 86400) THEN
    p_start_seconds := NULL;
  END IF;

  -- The usual checks (in the conversation, open, a valid thread, text length) and the insert.
  v_id := public.chat_post_message(p_channel_id, p_body, p_thread_root_id, NULL::jsonb);
  INSERT INTO public.chat_message_videos (message_id, lesson_id, open_to_channel, start_seconds)
  VALUES (v_id, p_lesson_id, p_open_to_channel, p_start_seconds);
  RETURN v_id;
END;
$function$;

COMMENT ON FUNCTION public.chat_post_shared_video(text, text, text, boolean, text, integer) IS
  'Posts a message (or a thread reply) that shares a course lesson''s video, from an optional start second, and records the share, in one transaction. Checks the sharer can open the lesson (admins any); only an admin can open it to the channel.';

REVOKE ALL ON FUNCTION public.chat_post_shared_video(text, text, text, boolean, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_post_shared_video(text, text, text, boolean, text, integer) TO authenticated, service_role;

-- The five-argument form, now a thin call to the new one.
CREATE OR REPLACE FUNCTION public.chat_post_shared_video(p_channel_id text, p_body text, p_lesson_id text, p_open_to_channel boolean, p_thread_root_id text)
 RETURNS text
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.chat_post_shared_video(p_channel_id, p_body, p_lesson_id, p_open_to_channel, p_thread_root_id, NULL::integer);
$function$;

NOTIFY pgrst, 'reload schema';
