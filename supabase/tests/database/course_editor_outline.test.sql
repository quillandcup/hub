-- pgTAP tests for the course editor's outline rules (20270317000000): an admin adds, renames, deletes,
-- duplicates and reorders the modules and lessons of a Hub-owned course with their own client, which writes
-- the audit log as them; a course imported from Kajabi, and anyone who isn't an admin, can't be written; and
-- the database keeps a course's structure sound (same course, one level of submodules). Runs in one
-- transaction that is rolled back, so it leaves the shared local DB untouched. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(38);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000e1a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'outline-alice@example.test'),
  ('00000000-0000-4000-a000-00000000e1a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'outline-dana@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000e1a1', 'outline-alice@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000e1a4', 'outline-dana@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

-- Two Hub-owned courses and one imported from Kajabi, each with a module and a lesson.
INSERT INTO public.courses (id, slug, title, source, source_key) VALUES
  ('crs_OutlineHub001', 'pgtap-outline-hub', 'Hub Course', 'hub', NULL),
  ('crs_OutlineHub002', 'pgtap-outline-hub-2', 'Other Hub Course', 'hub', NULL),
  ('crs_OutlineKaj001', 'pgtap-outline-kajabi', 'Imported Course', 'kajabi', 'pgtap-outline-kajabi');
INSERT INTO public.course_modules (id, course_id, parent_id, title, position, state, source, source_key) VALUES
  ('mod_OutlineKaj001', 'crs_OutlineKaj001', NULL, 'Imported Module', 1, 'open', 'kajabi', 'pgtap-outline-m'),
  ('mod_OutlineHub002', 'crs_OutlineHub002', NULL, 'Other Course Module', 1, 'hidden', 'hub', NULL),
  ('mod_OutlineA00001', 'crs_OutlineHub001', NULL, 'Module A', 1, 'hidden', 'hub', NULL),
  ('mod_OutlineB00001', 'crs_OutlineHub001', NULL, 'Module B', 2, 'hidden', 'hub', NULL),
  ('mod_OutlineC00001', 'crs_OutlineHub001', NULL, 'Module C', 3, 'hidden', 'hub', NULL),
  ('mod_OutlineWk0001', 'crs_OutlineHub001', 'mod_OutlineA00001', 'Week 1', 1, 'hidden', 'hub', NULL);
INSERT INTO public.course_lessons (id, course_id, module_id, title, position, state, body_html, source, source_key) VALUES
  ('les_OutlineKaj001', 'crs_OutlineKaj001', 'mod_OutlineKaj001', 'Imported Lesson', 1, 'open', '<p>kajabi</p>', 'kajabi', 'pgtap-outline-l'),
  ('les_OutlineL00001', 'crs_OutlineHub001', 'mod_OutlineWk0001', 'Lesson 1', 1, 'hidden', '<p>one</p>', 'hub', NULL),
  ('les_OutlineL00002', 'crs_OutlineHub001', 'mod_OutlineWk0001', 'Lesson 2', 2, 'hidden', '<p>two</p>', 'hub', NULL),
  ('les_OutlineL00003', 'crs_OutlineHub001', 'mod_OutlineWk0001', 'Lesson 3', 3, 'hidden', NULL, 'hub', NULL);

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;

-- Whether a statement was refused (RLS, a privilege or a constraint) instead of stopping the test.
CREATE FUNCTION pg_temp.refused(sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql;
  RETURN false;
EXCEPTION WHEN insufficient_privilege OR check_violation OR foreign_key_violation THEN
  RETURN true;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.refused(text) TO authenticated;

-- The message a statement was refused with ('' when it wasn't), for the functions' own errors.
CREATE FUNCTION pg_temp.failure(sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql;
  RETURN '';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.failure(text) TO authenticated;

SET LOCAL ROLE authenticated;

-- Alice (a member) can't write the outline or call its functions.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000e1a1", "email": "outline-alice@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'member_module_refused', to_jsonb(pg_temp.refused($$INSERT INTO public.course_modules (course_id, title, source) VALUES ('crs_OutlineHub001', 'Alice''s', 'hub')$$));
INSERT INTO result SELECT 'member_lesson_refused', to_jsonb(pg_temp.refused($$INSERT INTO public.course_lessons (course_id, title, source) VALUES ('crs_OutlineHub001', 'Alice''s', 'hub')$$));
INSERT INTO result SELECT 'member_reorder_refused', to_jsonb(pg_temp.failure($$SELECT public.reorder_course_children('crs_OutlineHub001', 'module', NULL, ARRAY['mod_OutlineC00001','mod_OutlineB00001','mod_OutlineA00001'])$$) <> '');

-- Dana (an admin).
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000e1a4", "email": "outline-dana@example.test", "role": "authenticated"}', true);

-- Add, rename, delete.
INSERT INTO public.course_modules (course_id, title, position, source) VALUES ('crs_OutlineHub001', 'Added Module', 4, 'hub');
INSERT INTO result SELECT 'admin_module_id_short', to_jsonb(id LIKE 'mod\_%') FROM public.course_modules WHERE title = 'Added Module';
INSERT INTO public.course_lessons (course_id, module_id, title, position, state, source) VALUES ('crs_OutlineHub001', 'mod_OutlineB00001', 'Added Lesson', 1, 'hidden', 'hub');
INSERT INTO result SELECT 'admin_lesson_defaults', to_jsonb(state || ':' || source) FROM public.course_lessons WHERE title = 'Added Lesson';
UPDATE public.course_lessons SET title = 'Lesson 1, renamed' WHERE id = 'les_OutlineL00001';
INSERT INTO result SELECT 'admin_rename_took', to_jsonb(title) FROM public.course_lessons WHERE id = 'les_OutlineL00001';
DELETE FROM public.course_modules WHERE id = 'mod_OutlineC00001';
INSERT INTO result SELECT 'admin_delete_took', to_jsonb(count(*)) FROM public.course_modules WHERE id = 'mod_OutlineC00001';

-- Nothing of an imported course, and nothing hub-owned inside one.
UPDATE public.course_lessons SET title = 'Hacked' WHERE id = 'les_OutlineKaj001';
INSERT INTO result SELECT 'kajabi_lesson_title', to_jsonb(title) FROM public.course_lessons WHERE id = 'les_OutlineKaj001';
DELETE FROM public.course_modules WHERE id = 'mod_OutlineKaj001';
INSERT INTO result SELECT 'kajabi_module_survives', to_jsonb(count(*)) FROM public.course_modules WHERE id = 'mod_OutlineKaj001';
INSERT INTO result SELECT 'hub_module_in_kajabi_course_refused', to_jsonb(pg_temp.refused($$INSERT INTO public.course_modules (course_id, title, source) VALUES ('crs_OutlineKaj001', 'Sneaky', 'hub')$$));
INSERT INTO result SELECT 'kajabi_source_module_refused', to_jsonb(pg_temp.refused($$INSERT INTO public.course_modules (course_id, title, source, source_key) VALUES ('crs_OutlineHub001', 'Sneaky', 'kajabi', 'pgtap-sneaky')$$));

-- Structure: same course, one level of submodules.
INSERT INTO result SELECT 'lesson_in_other_courses_module_refused', to_jsonb(pg_temp.refused($$INSERT INTO public.course_lessons (course_id, module_id, title, source) VALUES ('crs_OutlineHub001', 'mod_OutlineHub002', 'Wrong course', 'hub')$$));
INSERT INTO result SELECT 'submodule_under_other_courses_module_refused', to_jsonb(pg_temp.refused($$INSERT INTO public.course_modules (course_id, parent_id, title, source) VALUES ('crs_OutlineHub001', 'mod_OutlineHub002', 'Wrong course', 'hub')$$));
INSERT INTO result SELECT 'third_level_refused', to_jsonb(pg_temp.refused($$INSERT INTO public.course_modules (course_id, parent_id, title, source) VALUES ('crs_OutlineHub001', 'mod_OutlineWk0001', 'Too deep', 'hub')$$));
INSERT INTO result SELECT 'module_with_children_under_another_refused', to_jsonb(pg_temp.refused($$UPDATE public.course_modules SET parent_id = 'mod_OutlineB00001' WHERE id = 'mod_OutlineA00001'$$));
INSERT INTO result SELECT 'own_parent_refused', to_jsonb(pg_temp.refused($$UPDATE public.course_modules SET parent_id = id WHERE id = 'mod_OutlineB00001'$$));

-- Reorder: the lessons of Week 1 reversed; a stale list refused; a partial list refused; an imported course's refused.
SELECT public.reorder_course_children('crs_OutlineHub001', 'lesson', 'mod_OutlineWk0001', ARRAY['les_OutlineL00003','les_OutlineL00002','les_OutlineL00001']);
INSERT INTO result SELECT 'reordered_lessons', to_jsonb(array_agg(id ORDER BY position)) FROM public.course_lessons WHERE module_id = 'mod_OutlineWk0001';
INSERT INTO result SELECT 'stale_reorder_message', to_jsonb(pg_temp.failure($$SELECT public.reorder_course_children('crs_OutlineHub001', 'lesson', 'mod_OutlineWk0001', ARRAY['les_OutlineL00003','les_OutlineL00002'])$$));
INSERT INTO result SELECT 'duplicate_ids_message', to_jsonb(pg_temp.failure($$SELECT public.reorder_course_children('crs_OutlineHub001', 'lesson', 'mod_OutlineWk0001', ARRAY['les_OutlineL00003','les_OutlineL00003','les_OutlineL00002','les_OutlineL00001'])$$));
INSERT INTO result SELECT 'kajabi_reorder_message', to_jsonb(pg_temp.failure($$SELECT public.reorder_course_children('crs_OutlineKaj001', 'lesson', 'mod_OutlineKaj001', ARRAY['les_OutlineKaj001'])$$));
SELECT public.reorder_course_children('crs_OutlineHub001', 'module', NULL, (SELECT array_agg(id ORDER BY title DESC) FROM public.course_modules WHERE course_id = 'crs_OutlineHub001' AND parent_id IS NULL));
INSERT INTO result SELECT 'reordered_modules', to_jsonb(array_agg(title ORDER BY position)) FROM public.course_modules WHERE course_id = 'crs_OutlineHub001' AND parent_id IS NULL;

-- A reorder to the order it is already in changes nothing, and writes no audit entry.
SELECT public.reorder_course_children('crs_OutlineHub001', 'lesson', 'mod_OutlineWk0001', (SELECT array_agg(id ORDER BY position) FROM public.course_lessons WHERE module_id = 'mod_OutlineWk0001'));

-- Duplicate: a lesson; then a module with its submodule and their lessons.
INSERT INTO result SELECT 'duplicate_lesson_id_short', to_jsonb(public.duplicate_course_lesson('les_OutlineL00002') LIKE 'les\_%');
INSERT INTO result SELECT 'duplicate_lesson', to_jsonb(title || ':' || state || ':' || source || ':' || coalesce(body_html, '') || ':' || position) FROM public.course_lessons WHERE title = 'Lesson 2 (copy)';
INSERT INTO result SELECT 'duplicate_kajabi_lesson_message', to_jsonb(pg_temp.failure($$SELECT public.duplicate_course_lesson('les_OutlineKaj001')$$) <> '');
SELECT public.duplicate_course_module('mod_OutlineA00001');
INSERT INTO result SELECT 'duplicate_module_modules', to_jsonb(count(*)) FROM public.course_modules WHERE course_id = 'crs_OutlineHub001' AND (title = 'Module A (copy)' OR (title = 'Week 1' AND parent_id IN (SELECT id FROM public.course_modules WHERE title = 'Module A (copy)')));
INSERT INTO result SELECT 'duplicate_module_lessons', to_jsonb(count(*)) FROM public.course_lessons WHERE module_id IN (SELECT id FROM public.course_modules WHERE title = 'Week 1' AND parent_id IN (SELECT id FROM public.course_modules WHERE title = 'Module A (copy)'));
INSERT INTO result SELECT 'duplicate_module_hidden', to_jsonb(bool_and(state = 'hidden')) FROM public.course_modules WHERE title = 'Module A (copy)';
RESET ROLE;

-- The service role (no auth.uid()) rewrites an imported module, as the Kajabi sync does.
UPDATE public.course_modules SET title = 'Imported Module, resynced' WHERE id = 'mod_OutlineKaj001';

SELECT is((SELECT value FROM result WHERE label = 'member_module_refused'), 'true'::jsonb, 'a member can''t add a module');
SELECT is((SELECT value FROM result WHERE label = 'member_lesson_refused'), 'true'::jsonb, 'a member can''t add a lesson');
SELECT is((SELECT value FROM result WHERE label = 'member_reorder_refused'), 'true'::jsonb, 'a member can''t reorder (the function runs as them)');
SELECT is((SELECT value FROM result WHERE label = 'admin_module_id_short'), 'true'::jsonb, 'an added module gets a short mod_ id');
SELECT is((SELECT value FROM result WHERE label = 'admin_lesson_defaults'), '"hidden:hub"'::jsonb, 'an admin adds a Hub-owned lesson, hidden from members');
SELECT is((SELECT value FROM result WHERE label = 'admin_rename_took'), '"Lesson 1, renamed"'::jsonb, 'an admin renames a Hub-owned lesson');
SELECT is((SELECT value FROM result WHERE label = 'admin_delete_took'), '0'::jsonb, 'an admin deletes a Hub-owned module');
SELECT is((SELECT value FROM result WHERE label = 'kajabi_lesson_title'), '"Imported Lesson"'::jsonb, 'an admin can''t edit an imported lesson');
SELECT is((SELECT value FROM result WHERE label = 'kajabi_module_survives'), '1'::jsonb, 'an admin can''t delete an imported module');
SELECT is((SELECT value FROM result WHERE label = 'hub_module_in_kajabi_course_refused'), 'true'::jsonb, 'an admin can''t add a Hub-owned module to an imported course');
SELECT is((SELECT value FROM result WHERE label = 'kajabi_source_module_refused'), 'true'::jsonb, 'an admin can''t add a Kajabi-owned module');
SELECT is((SELECT value FROM result WHERE label = 'lesson_in_other_courses_module_refused'), 'true'::jsonb, 'a lesson can''t sit in another course''s module');
SELECT is((SELECT value FROM result WHERE label = 'submodule_under_other_courses_module_refused'), 'true'::jsonb, 'a module can''t sit under another course''s module');
SELECT is((SELECT value FROM result WHERE label = 'third_level_refused'), 'true'::jsonb, 'a submodule can''t have submodules');
SELECT is((SELECT value FROM result WHERE label = 'module_with_children_under_another_refused'), 'true'::jsonb, 'a module with submodules can''t become a submodule');
SELECT is((SELECT value FROM result WHERE label = 'own_parent_refused'), 'true'::jsonb, 'a module can''t be its own parent');
SELECT is((SELECT value FROM result WHERE label = 'reordered_lessons'), '["les_OutlineL00003","les_OutlineL00002","les_OutlineL00001"]'::jsonb, 'reorder puts the lessons in the given order');
SELECT is((SELECT value FROM result WHERE label = 'stale_reorder_message'), '"stale_order"'::jsonb, 'a list missing a lesson is refused as stale');
SELECT is((SELECT value FROM result WHERE label = 'duplicate_ids_message'), '"stale_order"'::jsonb, 'a list with a repeated id is refused');
SELECT is((SELECT value FROM result WHERE label = 'kajabi_reorder_message'), '"not_editable"'::jsonb, 'reordering an imported course''s lessons is refused');
SELECT is((SELECT value FROM result WHERE label = 'reordered_modules'), '["Module B","Module A","Added Module"]'::jsonb, 'reorder puts the modules in the given order');
SELECT is((SELECT value FROM result WHERE label = 'duplicate_lesson'), '"Lesson 2 (copy):hidden:hub:<p>two</p>:4"'::jsonb, 'a duplicated lesson is a hidden Hub-owned copy with the text, at the end of its module');
SELECT is((SELECT value FROM result WHERE label = 'duplicate_lesson_id_short'), 'true'::jsonb, 'a duplicated lesson gets a short les_ id');
SELECT is((SELECT value FROM result WHERE label = 'duplicate_kajabi_lesson_message'), 'true'::jsonb, 'duplicating an imported lesson is refused');
SELECT is((SELECT value FROM result WHERE label = 'duplicate_module_modules'), '2'::jsonb, 'a duplicated module comes with its submodule');
SELECT is((SELECT value FROM result WHERE label = 'duplicate_module_lessons'), '4'::jsonb, 'a duplicated module comes with the lessons of its submodule');
SELECT is((SELECT value FROM result WHERE label = 'duplicate_module_hidden'), 'true'::jsonb, 'a duplicated module is hidden');

-- Audit: structure changes by the admin are recorded as them; a reorder and the Kajabi sync are not.
SELECT is(
  (SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'course_module' AND action = 'insert' AND entity_label = 'Added Module' AND changed_by = '00000000-0000-4000-a000-00000000e1a4' AND actor_kind = 'staff'),
  1, 'adding a module is audited as the admin');
SELECT is(
  (SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'course_lesson' AND entity_id = 'les_OutlineL00001' AND action = 'update' AND changes ? 'title' AND NOT changes ? 'position'),
  1, 'renaming a lesson is audited as the admin, and the later reorder of it adds no second row');
SELECT is(
  (SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'course_module' AND entity_id = 'mod_OutlineC00001' AND action = 'delete' AND changed_by = '00000000-0000-4000-a000-00000000e1a4'),
  1, 'deleting a module is audited as the admin');
SELECT is(
  (SELECT count(*)::int FROM public.audit_log WHERE entity_type IN ('course_module', 'course_lesson') AND entity_id IN ('mod_OutlineKaj001', 'les_OutlineKaj001')),
  0, 'the Kajabi sync rewriting an imported module is not audited');

-- A reorder is one entry for the list, with the order before and after, as the admin.
SELECT is(
  (SELECT jsonb_build_object('who', changed_by, 'kind', actor_kind, 'label', entity_label, 'old', changes #> '{order,old}', 'new', changes #> '{order,new}')
     FROM public.audit_log WHERE entity_type = 'course_lesson_order' AND entity_id = 'mod_OutlineWk0001'),
  jsonb_build_object('who', '00000000-0000-4000-a000-00000000e1a4', 'kind', 'staff', 'label', 'Week 1',
    'old', '["les_OutlineL00001","les_OutlineL00002","les_OutlineL00003"]'::jsonb,
    'new', '["les_OutlineL00003","les_OutlineL00002","les_OutlineL00001"]'::jsonb),
  'reordering a module''s lessons is one audit entry named for the module, with the order before and after');
SELECT is(
  (SELECT jsonb_build_object('label', entity_label, 'count', jsonb_array_length(changes #> '{order,new}'))
     FROM public.audit_log WHERE entity_type = 'course_module_order' AND entity_id = 'crs_OutlineHub001'),
  jsonb_build_object('label', 'Hub Course', 'count', 3),
  'reordering a course''s modules is one audit entry named for the course');
SELECT is(
  (SELECT count(*)::int FROM public.audit_log WHERE entity_type IN ('course_module_order', 'course_lesson_order')),
  2, 'a reorder that changed nothing, a stale list and a refused reorder write no entry');
SELECT is(
  (SELECT count(*)::int FROM public.audit_log WHERE entity_type IN ('course_module', 'course_lesson') AND action = 'update' AND changes ? 'position'),
  0, 'a reorder writes no entry per row, only the one for the list');
SELECT is(
  (SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'course_lesson_order' AND entity_id = 'mod_OutlineWk0001' AND txid = txid_current()),
  1, 'it is recorded in the same transaction as the reorder');

-- The server itself (the service role, no signed-in person) may reorder a Hub-owned course too, recorded as the system;
-- an anonymous caller may not.
SELECT set_config('request.jwt.claims', '{"role": "service_role"}', true);
SELECT public.reorder_course_children('crs_OutlineHub001', 'lesson', 'mod_OutlineWk0001', (SELECT array_agg(id ORDER BY position DESC) FROM public.course_lessons WHERE module_id = 'mod_OutlineWk0001'));
SELECT is(
  (SELECT jsonb_build_object('who', changed_by, 'kind', actor_kind) FROM public.audit_log WHERE entity_type = 'course_lesson_order' AND entity_id = 'mod_OutlineWk0001' AND actor_kind = 'system'),
  jsonb_build_object('who', NULL, 'kind', 'system'),
  'the service role may reorder a Hub-owned course, recorded as the system');
SELECT set_config('request.jwt.claims', '{"role": "anon"}', true);
SELECT throws_ok(
  $$SELECT public.reorder_course_children('crs_OutlineHub001', 'lesson', 'mod_OutlineWk0001', (SELECT array_agg(id) FROM public.course_lessons WHERE module_id = 'mod_OutlineWk0001'))$$,
  'P0001', 'not_editable', 'someone who isn''t signed in may not');

SELECT * FROM finish(true);
ROLLBACK;
