-- pgTAP tests for the settings of a course, its modules and its lessons (20270330000000): each has its
-- OWN setting, an item can simply follow what is above it, and the state members get is worked out from
-- them by one rule (lib/courses/visibility.ts is the same rule: keep the two in step, tests/lib/
-- courses-visibility-rule.test.ts has the same cases). Changing a setting is one audit entry for the
-- thing changed, and the states that merely follow are not audited row by row. Runs in one transaction that
-- is rolled back, so it leaves the shared local DB untouched. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(42);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000e2a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'settings-alice@example.test'),
  ('00000000-0000-4000-a000-00000000e2a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'settings-dana@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000e2a1', 'settings-alice@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000e2a4', 'settings-dana@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

-- The rule on its own.
SELECT is(public.course_visibility('published'), 'open', 'published is open');
SELECT is(public.course_visibility('locked'), 'coming_soon', 'locked is coming soon');
SELECT is(public.course_visibility('drip'), 'coming_soon', 'drip is coming soon');
SELECT is(public.course_visibility('draft'), 'hidden', 'a draft is hidden');
SELECT is(public.course_visibility(NULL), 'hidden', 'no setting is hidden');
SELECT is(public.course_visibility('whatever'), 'hidden', 'an unknown setting is hidden');
SELECT is(public.course_item_state('inherit', 'coming_soon'), 'coming_soon', 'following what is above is what is above');
SELECT is(public.course_item_state('published', 'coming_soon'), 'coming_soon', 'an item is never more visible than what is above it');
SELECT is(public.course_item_state('locked', 'open'), 'coming_soon', 'a locked item in an open parent is coming soon');
SELECT is(public.course_item_state('draft', 'open'), 'hidden', 'a draft in an open parent is hidden');
SELECT is(public.course_item_state('published', 'hidden'), 'hidden', 'nothing in a hidden parent is visible');

-- A Hub-owned course (a draft until published) with: module A (follows the course) holding submodule A1
-- (follows) with a lesson that follows, and a lesson with its own setting 'published'; module B (own
-- setting: locked) with a lesson that follows; a lesson in no module that follows.
INSERT INTO public.courses (id, slug, title, source) VALUES ('crs_Settings0001', 'pgtap-settings-hub', 'Hub Course', 'hub');
INSERT INTO public.course_modules (id, course_id, parent_id, title, position, publishing_option, source) VALUES
  ('mod_SettingsA0001', 'crs_Settings0001', NULL, 'Module A', 1, 'inherit', 'hub'),
  ('mod_SettingsB0001', 'crs_Settings0001', NULL, 'Module B', 2, 'locked', 'hub'),
  ('mod_SettingsA1001', 'crs_Settings0001', 'mod_SettingsA0001', 'Week A1', 1, 'inherit', 'hub');
INSERT INTO public.course_lessons (id, course_id, module_id, title, position, publishing_option, source) VALUES
  ('les_SettingsA1L01', 'crs_Settings0001', 'mod_SettingsA1001', 'Lesson in A1', 1, 'inherit', 'hub'),
  ('les_SettingsAOwn1', 'crs_Settings0001', 'mod_SettingsA0001', 'Own published in A', 1, 'published', 'hub'),
  ('les_SettingsB0L01', 'crs_Settings0001', 'mod_SettingsB0001', 'Lesson in B', 1, 'inherit', 'hub'),
  ('les_SettingsLoose', 'crs_Settings0001', NULL, 'Loose lesson', 1, 'inherit', 'hub');

-- An imported course: whatever Kajabi says, and the sync decides the states itself.
INSERT INTO public.courses (id, slug, title, source, source_key, is_draft) VALUES ('crs_SettingsKaj01', 'pgtap-settings-kajabi', 'Imported', 'kajabi', 'pgtap-settings-kajabi', false);
INSERT INTO public.course_modules (id, course_id, title, position, publishing_option, state, source, source_key) VALUES
  ('mod_SettingsKaj01', 'crs_SettingsKaj01', 'Imported Module', 1, 'locked', 'coming_soon', 'kajabi', 'pgtap-settings-km');
INSERT INTO public.course_lessons (id, course_id, module_id, title, position, publishing_option, state, source, source_key) VALUES
  ('les_SettingsKaj01', 'crs_SettingsKaj01', 'mod_SettingsKaj01', 'Imported Lesson', 1, 'published', 'open', 'kajabi', 'pgtap-settings-kl');

CREATE FUNCTION pg_temp.states() RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_object_agg(left(id, 17), state) FROM (
    SELECT id, state FROM public.course_modules WHERE course_id = 'crs_Settings0001'
    UNION ALL SELECT id, state FROM public.course_lessons WHERE course_id = 'crs_Settings0001') s
$$;

SELECT is((SELECT publishing_option || ':' || is_draft::text FROM public.courses WHERE id = 'crs_Settings0001'), 'draft:true', 'a new Hub-owned course is a draft, and so is_draft');
SELECT is(pg_temp.states(),
  '{"mod_SettingsA0001":"hidden","mod_SettingsB0001":"hidden","mod_SettingsA1001":"hidden","les_SettingsA1L01":"hidden","les_SettingsAOwn1":"hidden","les_SettingsB0L01":"hidden","les_SettingsLoose":"hidden"}'::jsonb,
  'in a draft course everything is hidden, even what has its own published setting (added with its state worked out)');
SELECT is((SELECT publishing_option || ':' || is_draft::text FROM public.courses WHERE id = 'crs_SettingsKaj01'), 'published:false', 'an imported course that isn''t a draft is published');

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;
GRANT SELECT ON result TO authenticated;
-- The message a statement was refused with ('' when it wasn't).
CREATE FUNCTION pg_temp.failure(sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql;
  RETURN '';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.failure(text) TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.states() TO authenticated;

SET LOCAL ROLE authenticated;

-- Alice (a member) can change nothing.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000e2a1", "email": "settings-alice@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'member_course', to_jsonb(pg_temp.failure($$SELECT public.set_course_status('crs_Settings0001', 'published')$$));
INSERT INTO result SELECT 'member_item', to_jsonb(pg_temp.failure($$SELECT public.set_course_item_status('module', 'mod_SettingsA0001', 'published')$$));

-- Dana (an admin).
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000e2a4", "email": "settings-dana@example.test", "role": "authenticated"}', true);

-- Items can be marked published while the course is still a draft: they wait, hidden, until it is switched on.
SELECT public.set_course_item_status('module', 'mod_SettingsA0001', 'published');
SELECT public.set_course_item_status('lesson', 'les_SettingsLoose', 'published');
INSERT INTO result SELECT 'marked_published_in_draft_course', pg_temp.states();
INSERT INTO result SELECT 'unsupported_drip', to_jsonb(pg_temp.failure($$SELECT public.set_course_item_status('lesson', 'les_SettingsLoose', 'drip')$$));
INSERT INTO result SELECT 'unsupported_scheduled', to_jsonb(pg_temp.failure($$SELECT public.set_course_item_status('lesson', 'les_SettingsLoose', 'scheduled')$$));
INSERT INTO result SELECT 'unsupported_course_drip', to_jsonb(pg_temp.failure($$SELECT public.set_course_status('crs_Settings0001', 'drip')$$));
INSERT INTO result SELECT 'unknown_kind', to_jsonb(pg_temp.failure($$SELECT public.set_course_item_status('chapter', 'mod_SettingsA0001', 'draft')$$));
INSERT INTO result SELECT 'not_found', to_jsonb(pg_temp.failure($$SELECT public.set_course_item_status('lesson', 'les_Nope00000001', 'draft')$$));
INSERT INTO result SELECT 'course_not_found', to_jsonb(pg_temp.failure($$SELECT public.set_course_status('crs_Nope00000001', 'draft')$$));
INSERT INTO result SELECT 'imported_item', to_jsonb(pg_temp.failure($$SELECT public.set_course_item_status('lesson', 'les_SettingsKaj01', 'draft')$$));
INSERT INTO result SELECT 'imported_course', to_jsonb(pg_temp.failure($$SELECT public.set_course_status('crs_SettingsKaj01', 'draft')$$));

-- Publish the whole course: what follows it opens, what is locked is coming soon.
SELECT public.set_course_status('crs_Settings0001', 'published');
INSERT INTO result SELECT 'course_published', pg_temp.states();
-- Lock the whole course: everything is at most coming soon.
SELECT public.set_course_status('crs_Settings0001', 'locked');
INSERT INTO result SELECT 'course_locked', pg_temp.states();
-- Back to published, then a draft module hides what is under it, including what has its own published setting.
SELECT public.set_course_status('crs_Settings0001', 'published');
SELECT public.set_course_item_status('module', 'mod_SettingsA0001', 'draft');
INSERT INTO result SELECT 'module_a_draft', pg_temp.states();
-- Under a draft module, what is under it can be marked published too, and waits; then the module's own setting
-- is the one switch for the whole section, either way.
SELECT public.set_course_item_status('module', 'mod_SettingsA1001', 'published');
SELECT public.set_course_item_status('lesson', 'les_SettingsA1L01', 'published');
INSERT INTO result SELECT 'section_waiting', pg_temp.states();
SELECT public.set_course_item_status('module', 'mod_SettingsA0001', 'published');
INSERT INTO result SELECT 'section_on', pg_temp.states();
SELECT public.set_course_item_status('module', 'mod_SettingsA0001', 'draft');
INSERT INTO result SELECT 'section_off', pg_temp.states();
-- A locked module also allows publishing under it.
SELECT public.set_course_item_status('lesson', 'les_SettingsB0L01', 'published');
INSERT INTO result SELECT 'published_in_locked_module', to_jsonb((SELECT state FROM public.course_lessons WHERE id = 'les_SettingsB0L01'));
-- Back to following: the module follows the (published) course again, and what it holds opens.
SELECT public.set_course_item_status('module', 'mod_SettingsA0001', 'inherit');
INSERT INTO result SELECT 'module_a_follows_again', pg_temp.states();
-- A setting set to what it already is changes nothing.
SELECT public.set_course_item_status('module', 'mod_SettingsA0001', 'inherit');
SELECT public.set_course_status('crs_Settings0001', 'published');

-- A new item in a published course is open straight away (it follows), and a copy is a draft.
INSERT INTO public.course_lessons (id, course_id, module_id, title, position, publishing_option, source) VALUES ('les_SettingsNew001', 'crs_Settings0001', 'mod_SettingsA0001', 'Added later', 9, 'inherit', 'hub');
INSERT INTO result SELECT 'added_to_published_course', to_jsonb((SELECT state FROM public.course_lessons WHERE id = 'les_SettingsNew001'));
SELECT public.duplicate_course_lesson('les_SettingsNew001');
INSERT INTO result SELECT 'copy_is_draft', to_jsonb((SELECT publishing_option || ':' || state FROM public.course_lessons WHERE title = 'Added later (copy)'));
RESET ROLE;

-- The Kajabi sync (the service role) writes imported rows as it likes; an inserted imported row keeps the state it was given.
INSERT INTO public.course_modules (id, course_id, title, position, publishing_option, state, source, source_key) VALUES
  ('mod_SettingsKaj02', 'crs_SettingsKaj01', 'Imported 2', 2, 'draft', 'open', 'kajabi', 'pgtap-settings-km2');
-- An imported course follows its draft flag, as the publish step flips it.
UPDATE public.courses SET is_draft = true WHERE id = 'crs_SettingsKaj01';
SELECT is((SELECT publishing_option FROM public.courses WHERE id = 'crs_SettingsKaj01'), 'draft', 'an imported course made a draft has the draft setting');
UPDATE public.courses SET is_draft = false WHERE id = 'crs_SettingsKaj01';
SELECT is((SELECT publishing_option FROM public.courses WHERE id = 'crs_SettingsKaj01'), 'published', 'and published again when it is');

SELECT is((SELECT value FROM result WHERE label = 'member_course'), '"not_editable"'::jsonb, 'a member can''t change a course''s setting');
SELECT is((SELECT value FROM result WHERE label = 'member_item'), '"not_editable"'::jsonb, 'a member can''t change an item''s setting');
SELECT is((SELECT value FROM result WHERE label = 'marked_published_in_draft_course'),
  '{"mod_SettingsA0001":"hidden","mod_SettingsB0001":"hidden","mod_SettingsA1001":"hidden","les_SettingsA1L01":"hidden","les_SettingsAOwn1":"hidden","les_SettingsB0L01":"hidden","les_SettingsLoose":"hidden"}'::jsonb,
  'a module and a lesson can be marked published while the course is a draft, and wait, hidden');
SELECT is((SELECT value FROM result WHERE label = 'unsupported_drip'), '"unsupported_status"'::jsonb, 'drip isn''t offered yet');
SELECT is((SELECT value FROM result WHERE label = 'unsupported_scheduled'), '"unsupported_status"'::jsonb, 'nor scheduled');
SELECT is((SELECT value FROM result WHERE label = 'unsupported_course_drip'), '"unsupported_status"'::jsonb, 'nor for a course');
SELECT is((SELECT value FROM result WHERE label = 'unknown_kind'), '"unknown_kind"'::jsonb, 'an unknown kind is refused');
SELECT is((SELECT value FROM result WHERE label = 'not_found'), '"not_found"'::jsonb, 'an item that isn''t there is not found');
SELECT is((SELECT value FROM result WHERE label = 'course_not_found'), '"not_found"'::jsonb, 'a course that isn''t there is not found');
SELECT is((SELECT value FROM result WHERE label = 'imported_item'), '"not_editable"'::jsonb, 'an imported item can''t be changed');
SELECT is((SELECT value FROM result WHERE label = 'imported_course'), '"not_editable"'::jsonb, 'nor an imported course');
SELECT is((SELECT value FROM result WHERE label = 'course_published'),
  '{"mod_SettingsA0001":"open","mod_SettingsB0001":"coming_soon","mod_SettingsA1001":"open","les_SettingsA1L01":"open","les_SettingsAOwn1":"open","les_SettingsB0L01":"coming_soon","les_SettingsLoose":"open"}'::jsonb,
  'publishing the course opens what follows it, and what is locked is coming soon');
SELECT is((SELECT value FROM result WHERE label = 'course_locked'),
  '{"mod_SettingsA0001":"coming_soon","mod_SettingsB0001":"coming_soon","mod_SettingsA1001":"coming_soon","les_SettingsA1L01":"coming_soon","les_SettingsAOwn1":"coming_soon","les_SettingsB0L01":"coming_soon","les_SettingsLoose":"coming_soon"}'::jsonb,
  'locking the course makes everything at most coming soon, even a lesson with its own published setting');
SELECT is((SELECT value FROM result WHERE label = 'module_a_draft'),
  '{"mod_SettingsA0001":"hidden","mod_SettingsB0001":"coming_soon","mod_SettingsA1001":"hidden","les_SettingsA1L01":"hidden","les_SettingsAOwn1":"hidden","les_SettingsB0L01":"coming_soon","les_SettingsLoose":"open"}'::jsonb,
  'a draft module hides what is under it, its submodule and a lesson with its own published setting included');
SELECT is((SELECT value FROM result WHERE label = 'section_waiting'),
  '{"mod_SettingsA0001":"hidden","mod_SettingsB0001":"coming_soon","mod_SettingsA1001":"hidden","les_SettingsA1L01":"hidden","les_SettingsAOwn1":"hidden","les_SettingsB0L01":"coming_soon","les_SettingsLoose":"open"}'::jsonb,
  'everything under a draft module can be marked published, and waits, hidden');
SELECT is((SELECT value FROM result WHERE label = 'section_on'),
  '{"mod_SettingsA0001":"open","mod_SettingsB0001":"coming_soon","mod_SettingsA1001":"open","les_SettingsA1L01":"open","les_SettingsAOwn1":"open","les_SettingsB0L01":"coming_soon","les_SettingsLoose":"open"}'::jsonb,
  'publishing the module opens the whole section at once');
SELECT is((SELECT value FROM result WHERE label = 'section_off'),
  '{"mod_SettingsA0001":"hidden","mod_SettingsB0001":"coming_soon","mod_SettingsA1001":"hidden","les_SettingsA1L01":"hidden","les_SettingsAOwn1":"hidden","les_SettingsB0L01":"coming_soon","les_SettingsLoose":"open"}'::jsonb,
  'and making it a draft closes the whole section again');
SELECT is((SELECT value FROM result WHERE label = 'published_in_locked_module'), '"coming_soon"'::jsonb, 'a lesson published in a locked module is allowed, and is coming soon');
SELECT is((SELECT value FROM result WHERE label = 'module_a_follows_again'),
  '{"mod_SettingsA0001":"open","mod_SettingsB0001":"coming_soon","mod_SettingsA1001":"open","les_SettingsA1L01":"open","les_SettingsAOwn1":"open","les_SettingsB0L01":"coming_soon","les_SettingsLoose":"open"}'::jsonb,
  'a module set to follow again opens with the course, and what it holds with it');
SELECT is((SELECT value FROM result WHERE label = 'added_to_published_course'), '"open"'::jsonb, 'a lesson added to a published course follows it, open');
SELECT is((SELECT value FROM result WHERE label = 'copy_is_draft'), '"draft:hidden"'::jsonb, 'a copy is a draft');
SELECT is((SELECT state FROM public.course_modules WHERE id = 'mod_SettingsKaj02'), 'open', 'an imported row keeps the state the sync gave it');

-- Audit: a setting changed is one entry for the thing changed; the states that follow are not entries.
SELECT is(
  (SELECT jsonb_build_object('who', changed_by, 'kind', actor_kind, 'label', entity_label, 'changes', changes - 'updated_at')
     FROM public.audit_log WHERE entity_type = 'course_lesson' AND entity_id = 'les_SettingsB0L01' AND action = 'update'),
  jsonb_build_object('who', '00000000-0000-4000-a000-00000000e2a4', 'kind', 'staff', 'label', 'Lesson in B',
    'changes', '{"publishing_option": {"old": "inherit", "new": "published"}}'::jsonb),
  'changing a lesson''s setting is one entry for that lesson, as the admin, with the setting before and after (and not its state)');
SELECT is(
  (SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'course_module' AND entity_id = 'mod_SettingsA0001' AND action = 'update'),
  0, 'a module set to draft and back to follow in one transaction nets out to nothing: no entry for an intent that cancelled itself');
SELECT is(
  (SELECT count(*)::int FROM public.audit_log WHERE entity_type IN ('course_module', 'course_lesson') AND action = 'update' AND changes ? 'state'),
  0, 'a state that only follows a setting is never an entry of its own');
SELECT is(
  (SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'course' AND entity_id = 'crs_Settings0001' AND action = 'update' AND changes ? 'publishing_option'),
  1, 'the whole course''s setting, changed several times in a transaction, is one entry for the course');

SELECT * FROM finish(true);
ROLLBACK;
