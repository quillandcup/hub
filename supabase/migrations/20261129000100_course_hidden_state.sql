-- Draft ("hidden") lessons and modules are now kept in the Hub so staff can preview them, which means
-- the Hub tables must be able to hold them without members ever seeing them.
--
-- Until now Silver only held what members could see (open or "Coming soon"); a Kajabi draft was
-- dropped. Now every module and lesson is stored with its effective state, `hidden` for a draft (or
-- anything under one), and the member-facing reads leave `hidden` out:
--   * lessons: members already read only `open` ones (20261112000300), so a hidden lesson is
--     already out of their reach;
--   * modules: members read every module of a course they can open, so a hidden module needs the
--     same rule: staff read all, members read those that aren't hidden;
--   * lesson downloads: already tied to an open lesson (20261112000300).
-- The app pages read through the server and filter hidden rows themselves for members; this is the
-- database backing that up, so a draft can't leak through the API.

ALTER TABLE public.course_modules DROP CONSTRAINT IF EXISTS course_modules_state_check;
ALTER TABLE public.course_modules
  ADD CONSTRAINT course_modules_state_check CHECK (state IN ('open', 'coming_soon', 'hidden'));

ALTER TABLE public.course_lessons DROP CONSTRAINT IF EXISTS course_lessons_state_check;
ALTER TABLE public.course_lessons
  ADD CONSTRAINT course_lessons_state_check CHECK (state IN ('open', 'coming_soon', 'hidden'));

DROP POLICY IF EXISTS "Members with access and admins read course_modules" ON public.course_modules;
CREATE POLICY "Staff read all modules, members with access read those that aren't hidden" ON public.course_modules
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin()) OR (state <> 'hidden' AND public.has_course_access(course_id)));

COMMENT ON COLUMN public.course_lessons.state IS
  'What members get: open, coming_soon (title only), or hidden (a Kajabi draft, or under one): kept so staff can preview it, never shown to members.';
COMMENT ON COLUMN public.course_modules.state IS
  'What members get: open, coming_soon, or hidden (a Kajabi draft, or under one): kept so staff can preview it, never shown to members.';
