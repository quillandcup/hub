-- Members could read the row of a lesson that is still "Coming soon" straight through the API,
-- including its text and video link, even though the app never shows it. Members now read only
-- open lessons through row-level security; staff read all of them (the staff preview opens
-- coming-soon lessons). The member pages read through the server and decide for themselves, so
-- nothing changes for them. Titles in the outline come from the same server read.

DROP POLICY IF EXISTS "Members with access and admins read course_lessons" ON public.course_lessons;
CREATE POLICY "Staff read all lessons, members with access read open ones" ON public.course_lessons
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin()) OR (state = 'open' AND public.has_course_access(course_id)));

-- Downloads belong to the lesson they're on: same rule.
DROP POLICY IF EXISTS "Members with access and admins read course_lesson_files" ON public.course_lesson_files;
CREATE POLICY "Members with access and admins read course_lesson_files" ON public.course_lesson_files
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_admin())
    OR EXISTS (
      SELECT 1 FROM public.course_lessons l
      WHERE l.id = course_lesson_files.lesson_id AND l.state = 'open' AND public.has_course_access(l.course_id)
    )
  );
