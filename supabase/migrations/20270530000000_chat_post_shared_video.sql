-- Posting a message that shares a lesson video in one database call, and an admin's choice to open it to the channel.
--
-- 1. One call. The share action used to post the message (chat_post_message) and then write the chat_message_videos
--    row with the service role. Realtime delivers the message when it commits, so another member's open page could
--    receive it and draw it without the video card until a reload. chat_post_shared_video does both in one
--    transaction, so the message is never visible without its video.
-- 2. The checks live in the function, because it is callable by any signed-in member through the Data API:
--    the sharer must be able to open the lesson themselves (an open lesson of a published course they have access
--    to, or any lesson for an admin), the lesson must have a video, and only an admin can open it to the channel.
-- 3. open_to_channel: when an admin shares with it on, members of the channel who do not have the course can
--    play the video too (app/api/chat/videos). Off by default; nothing else about the course opens.
set lock_timeout = '5s';

ALTER TABLE public.chat_message_videos ADD COLUMN open_to_channel boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.chat_message_videos.open_to_channel IS
  'An admin chose, when sharing, to let every member who can read the message play the video, whether or not they have the course. Only an admin can set it (chat_post_shared_video).';

CREATE FUNCTION public.chat_post_shared_video(p_channel_id text, p_body text, p_lesson_id text, p_open_to_channel boolean DEFAULT false)
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

  -- The usual checks (in the channel, bridged, open, text length) and the insert.
  v_id := public.chat_post_message(p_channel_id, p_body, NULL::text, NULL::jsonb);
  INSERT INTO public.chat_message_videos (message_id, lesson_id, open_to_channel) VALUES (v_id, p_lesson_id, p_open_to_channel);
  RETURN v_id;
END;
$function$;

COMMENT ON FUNCTION public.chat_post_shared_video(text, text, text, boolean) IS
  'Posts a message that shares a course lesson''s video, and records the share, in one transaction. Checks the sharer can open the lesson (admins any); only an admin can open it to the channel.';

REVOKE ALL ON FUNCTION public.chat_post_shared_video(text, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_post_shared_video(text, text, text, boolean) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
