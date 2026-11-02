-- Move a lesson of a Hub-owned course into another module of the same course (or out of every module), from the
-- lesson's own page. It goes to the end of the module it lands in. What members see follows from where it now is
-- (a module that is a draft hides what is in it), so the states are worked out again, and the audit log gets the
-- one entry a person would expect: the lesson, with its module before and after.

set lock_timeout = '5s';

CREATE FUNCTION public.move_course_lesson(p_lesson_id text, p_module_id text) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_course text;
  v_source text;
  v_old text;
BEGIN
  IF NOT (public.is_admin() OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'not_editable';
  END IF;
  SELECT course_id, source, module_id INTO v_course, v_source, v_old FROM course_lessons WHERE id = p_lesson_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  IF v_source <> 'hub' OR NOT EXISTS (SELECT 1 FROM courses WHERE id = v_course AND source = 'hub') THEN
    RAISE EXCEPTION 'not_editable';
  END IF;
  IF v_old IS NOT DISTINCT FROM p_module_id THEN
    RETURN;
  END IF;
  IF p_module_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM course_modules WHERE id = p_module_id AND course_id = v_course) THEN
    RAISE EXCEPTION 'module_not_found';
  END IF;

  -- The end of the list it joins. (The list it leaves keeps its numbers: they only order, and the next reorder renumbers.)
  UPDATE course_lessons
     SET module_id = p_module_id,
         position = coalesce((SELECT max(position) FROM course_lessons WHERE course_id = v_course AND module_id IS NOT DISTINCT FROM p_module_id), 0) + 1
   WHERE id = p_lesson_id;
  PERFORM public.recompute_course_states(v_course);
END $$;

REVOKE ALL ON FUNCTION public.move_course_lesson(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.move_course_lesson(text, text) TO authenticated;

COMMENT ON FUNCTION public.move_course_lesson(text, text) IS
  'Moves a lesson of a Hub-owned course to the end of another module of the course (null: out of every module). Admin only. One audit entry, for the lesson.';
