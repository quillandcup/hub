-- Delete a course: staff remove a Hub-owned course that nobody uses, such as a draft copy made by "Duplicate course".
--
-- `delete_course(p_course_id)` runs the checks and the delete in one transaction, so it happens completely or not at all.
-- A course can go only when:
--   * the Hub owns it (`source = 'hub'`): a course imported from Kajabi would be brought back by the next import, so it is
--     removed in Kajabi (or taken over first);
--   * it is a draft (`is_draft`): a published course is unpublished first, so taking it off the site is a step of its own;
--   * no member has or is due access (`course_access`, `course_access_grants`);
--   * no member left anything on it: lesson progress, lesson comments, or a chat message linked to one of its lessons.
-- Everything that hangs off it goes with it through the existing ON DELETE CASCADE keys: modules, lessons, lesson downloads
-- (rows only: the stored files and the shared videos and images are not touched, a duplicate may point at the same ones, and
-- the app removes a stored file only when no other row uses it), old addresses, comment follows and reads. No new table.
--
-- Errors, as for the other course functions: 'not_editable' (not an admin or the service role), 'not_found',
-- 'not_deletable' (imported from Kajabi), 'published', 'has_members', 'has_activity'.
--
-- Audit: the course's own delete entry says who deleted it and what it was (the existing trigger); this adds how many modules
-- and lessons went with it. The cascaded module and lesson rows would each write a delete entry of their own, so, as a copy
-- does for its inserts (20270710000000), the function sets `app.audit_skip_course` to the course's id for its own
-- transaction and those delete triggers stay quiet: one entry for the intent.

set lock_timeout = '5s';

DROP TRIGGER audit_row_change_hub_delete ON public.course_modules;
CREATE TRIGGER audit_row_change_hub_delete
  AFTER DELETE ON public.course_modules
  FOR EACH ROW WHEN (OLD.source = 'hub' AND current_setting('app.audit_skip_course', true) IS DISTINCT FROM OLD.course_id)
  EXECUTE FUNCTION audit_row_change('course_module', 'id');
DROP TRIGGER audit_row_change_hub_delete ON public.course_lessons;
CREATE TRIGGER audit_row_change_hub_delete
  AFTER DELETE ON public.course_lessons
  FOR EACH ROW WHEN (OLD.source = 'hub' AND current_setting('app.audit_skip_course', true) IS DISTINCT FROM OLD.course_id)
  EXECUTE FUNCTION audit_row_change('course_lesson', 'id');

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
  IF EXISTS (SELECT 1 FROM lesson_progress p JOIN course_lessons l ON l.id = p.lesson_id WHERE l.course_id = p_course_id)
     OR EXISTS (SELECT 1 FROM lesson_comments c JOIN course_lessons l ON l.id = c.lesson_id WHERE l.course_id = p_course_id)
     OR EXISTS (SELECT 1 FROM chat_message_videos v JOIN course_lessons l ON l.id = v.lesson_id WHERE l.course_id = p_course_id) THEN
    RAISE EXCEPTION 'has_activity';
  END IF;

  SELECT count(*) INTO v_modules FROM course_modules WHERE course_id = p_course_id;
  SELECT count(*) INTO v_lessons FROM course_lessons WHERE course_id = p_course_id;

  PERFORM set_config('app.audit_skip_course', p_course_id, true);
  DELETE FROM courses WHERE id = p_course_id;

  UPDATE audit_log
     SET changes = changes || jsonb_build_object(
           'modules_deleted', jsonb_build_object('old', v_modules, 'new', NULL),
           'lessons_deleted', jsonb_build_object('old', v_lessons, 'new', NULL))
   WHERE txid = txid_current() AND entity_type = 'course' AND entity_id = p_course_id AND action = 'delete';

  PERFORM set_config('app.audit_skip_course', '', true);
END $$;

REVOKE ALL ON FUNCTION public.delete_course(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_course(text) TO authenticated;
