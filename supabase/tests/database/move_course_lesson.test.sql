-- pgTAP tests for moving a lesson to another module (20270420000000): admin only, Hub-owned lessons only, a module of
-- the same course, to the end of the list it joins, with its state worked out again from the module it is now in and
-- one audit entry for the lesson. Runs in one transaction that is rolled back, so it leaves the shared local DB
-- untouched. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(13);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000e4a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'move-alice@example.test'),
  ('00000000-0000-4000-a000-00000000e4a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'move-dana@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000e4a1', 'move-alice@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000e4a4', 'move-dana@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

-- A Hub-owned course: module Open (published) with a lesson, module Hidden (a draft) with a lesson, and a lesson in no module.
INSERT INTO public.courses (id, slug, title, source) VALUES
  ('crs_MoveLesson01', 'pgtap-move', 'Move', 'hub'),
  ('crs_MoveOther001', 'pgtap-move-other', 'Other', 'hub'),
  ('crs_MoveKajabi01', 'pgtap-move-kajabi', 'Imported', 'kajabi');
INSERT INTO public.courses (id, slug, title, source, source_key) VALUES ('crs_MoveKajabi02', 'pgtap-move-kajabi2', 'Imported 2', 'kajabi', 'pgtap-move-k2');
INSERT INTO public.course_modules (id, course_id, title, position, publishing_option, state, source) VALUES
  ('mod_MoveOpen0001', 'crs_MoveLesson01', 'Open', 1, 'published', 'open', 'hub'),
  ('mod_MoveHidden01', 'crs_MoveLesson01', 'Hidden', 2, 'draft', 'hidden', 'hub'),
  ('mod_MoveOther001', 'crs_MoveOther001', 'Other module', 1, 'published', 'open', 'hub');
INSERT INTO public.course_lessons (id, course_id, module_id, title, position, publishing_option, state, source) VALUES
  ('les_MoveFirst001', 'crs_MoveLesson01', 'mod_MoveOpen0001', 'First', 1, 'published', 'open', 'hub'),
  ('les_MoveSecond01', 'crs_MoveLesson01', 'mod_MoveOpen0001', 'Second', 2, 'published', 'open', 'hub'),
  ('les_MoveInHid001', 'crs_MoveLesson01', 'mod_MoveHidden01', 'In hidden', 1, 'published', 'hidden', 'hub'),
  ('les_MoveLoose001', 'crs_MoveLesson01', NULL, 'Loose', 1, 'published', 'open', 'hub');
INSERT INTO public.course_lessons (id, course_id, title, position, publishing_option, state, source, source_key) VALUES
  ('les_MoveImport01', 'crs_MoveKajabi01', 'Imported lesson', 1, 'published', 'open', 'kajabi', 'pgtap-move-l');

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT, SELECT ON result TO authenticated;
CREATE FUNCTION pg_temp.failure(sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql;
  RETURN '';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.failure(text) TO authenticated;

SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000e4a1", "email": "move-alice@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'member', to_jsonb(pg_temp.failure($$SELECT public.move_course_lesson('les_MoveFirst001', 'mod_MoveHidden01')$$));

SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000e4a4", "email": "move-dana@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'unknown_lesson', to_jsonb(pg_temp.failure($$SELECT public.move_course_lesson('les_Nope00000001', 'mod_MoveHidden01')$$));
INSERT INTO result SELECT 'imported', to_jsonb(pg_temp.failure($$SELECT public.move_course_lesson('les_MoveImport01', NULL)$$));
INSERT INTO result SELECT 'other_course_module', to_jsonb(pg_temp.failure($$SELECT public.move_course_lesson('les_MoveFirst001', 'mod_MoveOther001')$$));
INSERT INTO result SELECT 'unknown_module', to_jsonb(pg_temp.failure($$SELECT public.move_course_lesson('les_MoveFirst001', 'mod_Nope00000001')$$));
-- Where it already is: nothing changes.
SELECT public.move_course_lesson('les_MoveFirst001', 'mod_MoveOpen0001');
-- Into the draft module: it goes last there, and is hidden now.
SELECT public.move_course_lesson('les_MoveFirst001', 'mod_MoveHidden01');
-- Out of every module, and back into the open one: last again, and open again.
SELECT public.move_course_lesson('les_MoveInHid001', NULL);
SELECT public.move_course_lesson('les_MoveLoose001', 'mod_MoveOpen0001');
RESET ROLE;

SELECT is((SELECT value FROM result WHERE label = 'member'), '"not_editable"'::jsonb, 'a member can''t move a lesson');
SELECT is((SELECT value FROM result WHERE label = 'unknown_lesson'), '"not_found"'::jsonb, 'a lesson that isn''t there is not found');
SELECT is((SELECT value FROM result WHERE label = 'imported'), '"not_editable"'::jsonb, 'an imported lesson can''t be moved');
SELECT is((SELECT value FROM result WHERE label = 'other_course_module'), '"module_not_found"'::jsonb, 'a module of another course is refused');
SELECT is((SELECT value FROM result WHERE label = 'unknown_module'), '"module_not_found"'::jsonb, 'a module that isn''t there is refused');

SELECT is((SELECT module_id || ':' || position::text || ':' || state FROM public.course_lessons WHERE id = 'les_MoveFirst001'), 'mod_MoveHidden01:2:hidden', 'a lesson moved into a draft module goes to the end of it and is hidden');
SELECT is((SELECT module_id || ':' || position::text || ':' || state FROM public.course_lessons WHERE id = 'les_MoveLoose001'), 'mod_MoveOpen0001:3:open', 'a lesson moved into an open module goes to the end of it and is open');
SELECT is((SELECT module_id IS NULL AND state = 'open' FROM public.course_lessons WHERE id = 'les_MoveInHid001'), true, 'a lesson moved out of every module has nothing above it, so it is open');
SELECT is((SELECT position FROM public.course_lessons WHERE id = 'les_MoveSecond01'), 2, 'the list a lesson left keeps its numbers');
SELECT is((SELECT module_id FROM public.course_lessons WHERE id = 'les_MoveImport01'), NULL, 'and the imported lesson is as it was');

SELECT is(
  (SELECT jsonb_build_object('who', changed_by, 'kind', actor_kind, 'label', entity_label, 'module', changes -> 'module_id')
     FROM public.audit_log WHERE entity_type = 'course_lesson' AND entity_id = 'les_MoveFirst001' AND action = 'update'),
  jsonb_build_object('who', '00000000-0000-4000-a000-00000000e4a4', 'kind', 'staff', 'label', 'First', 'module', '{"old": "mod_MoveOpen0001", "new": "mod_MoveHidden01"}'::jsonb),
  'moving a lesson is one entry for that lesson, as the admin, with its module before and after');
SELECT is(
  (SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'course_lesson' AND entity_id = 'les_MoveFirst001' AND action = 'update' AND changes ? 'state'),
  0, 'and the state that followed is not an entry of its own');
SELECT is(
  (SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'course_lesson' AND entity_id IN ('les_MoveSecond01', 'les_MoveImport01') AND action = 'update'),
  0, 'lessons that were not moved have no entry');

SELECT * FROM finish(true);
ROLLBACK;
