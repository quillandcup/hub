-- Delete a course: stray activity on an unused draft no longer blocks it (replaces delete_course of 20271123000000).
--
-- A draft Hub-owned course that nobody has access to can still hold a little activity left by staff trying it out:
-- a lesson marked complete, a test comment, a chat message that shares one of its lessons' videos. Refusing the delete
-- for that left a copy nobody could remove. Now only these block (as before): the course comes from Kajabi, it is
-- published, or any member has access or a grant (`course_access`, `course_access_grants`). Whoever may see a lesson
-- needs access, so a course with none has nothing a member is using.
--
-- What goes with the course, all through existing ON DELETE CASCADE keys, so nothing needs an explicit step:
-- lesson progress, lesson comments (with their replies, reports, follows and reads), and the link row of a chat message
-- that shares a lesson's video (`chat_message_videos`). The chat message itself stays: only its video link goes, so it
-- reads as a message without the video. The audit entry for the course says how many of each went, next to the
-- module and lesson counts (the cascaded rows write no entries of their own: those tables have no audit trigger, and
-- the module and lesson ones are quiet during this call, as before).
--
-- Errors: 'not_editable', 'not_found', 'not_deletable' (Kajabi), 'published', 'has_members'. 'has_activity' is gone.

set lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.delete_course(p_course_id text) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_source text;
  v_draft boolean;
  v_modules int;
  v_lessons int;
  v_progress int;
  v_comments int;
  v_chat int;
BEGIN
  IF NOT (coalesce(public.is_admin(), false) OR coalesce(auth.role() = 'service_role', false)) THEN
    RAISE EXCEPTION 'not_editable';
  END IF;
  SELECT source, is_draft INTO v_source, v_draft FROM courses WHERE id = p_course_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  IF v_source <> 'hub' THEN
    RAISE EXCEPTION 'not_deletable';
  END IF;
  IF NOT v_draft THEN
    RAISE EXCEPTION 'published';
  END IF;
  IF EXISTS (SELECT 1 FROM course_access WHERE course_id = p_course_id)
     OR EXISTS (SELECT 1 FROM course_access_grants WHERE course_id = p_course_id) THEN
    RAISE EXCEPTION 'has_members';
  END IF;

  SELECT count(*) INTO v_modules FROM course_modules WHERE course_id = p_course_id;
  SELECT count(*) INTO v_lessons FROM course_lessons WHERE course_id = p_course_id;
  SELECT count(*) INTO v_progress FROM lesson_progress p JOIN course_lessons l ON l.id = p.lesson_id WHERE l.course_id = p_course_id;
  SELECT count(*) INTO v_comments FROM lesson_comments c JOIN course_lessons l ON l.id = c.lesson_id WHERE l.course_id = p_course_id;
  SELECT count(*) INTO v_chat FROM chat_message_videos v JOIN course_lessons l ON l.id = v.lesson_id WHERE l.course_id = p_course_id;

  PERFORM set_config('app.audit_skip_course', p_course_id, true);
  DELETE FROM courses WHERE id = p_course_id;

  UPDATE audit_log
     SET changes = changes || jsonb_build_object(
           'modules_deleted', jsonb_build_object('old', v_modules, 'new', NULL),
           'lessons_deleted', jsonb_build_object('old', v_lessons, 'new', NULL),
           'progress_deleted', jsonb_build_object('old', v_progress, 'new', NULL),
           'comments_deleted', jsonb_build_object('old', v_comments, 'new', NULL),
           'chat_video_links_deleted', jsonb_build_object('old', v_chat, 'new', NULL))
   WHERE txid = txid_current() AND entity_type = 'course' AND entity_id = p_course_id AND action = 'delete';

  PERFORM set_config('app.audit_skip_course', '', true);
END $$;

REVOKE ALL ON FUNCTION public.delete_course(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_course(text) TO authenticated;
