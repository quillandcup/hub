-- pgTAP tests for the settings of a course's modules and lessons (20270401000000): each has its
-- OWN setting, an item can simply follow what is above it, and the state members get is worked out from
-- them by one rule (lib/courses/visibility.ts is the same rule: keep the two in step, tests/lib/
-- courses-visibility-rule.test.ts has the same cases). Changing a setting is one audit entry for the
-- thing changed, and the states that merely follow are not audited row by row. Runs in one transaction that
-- is rolled back, so it leaves the shared local DB untouched. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(32);

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
SELECT is(public.course_item_state('inherit', 'open'), 'hidden', 'a setting that no longer exists is hidden, even in an open parent');
SELECT is(public.course_item_state('published', 'coming_soon'), 'coming_soon', 'an item is never more visible than what is above it');
SELECT is(public.course_item_state('locked', 'open'), 'coming_soon', 'a locked item in an open parent is coming soon');
SELECT is(public.course_item_state('draft', 'open'), 'hidden', 'a draft in an open parent is hidden');
SELECT is(public.course_item_state('published', 'hidden'), 'hidden', 'nothing in a hidden parent is visible');

-- A Hub-owned course with: module A (follows: nothing is above it) holding submodule A1
-- (follows) with a lesson that follows, and a lesson with its own setting 'published'; module B (own
-- setting: locked) with a lesson that follows; a lesson in no module that follows.
INSERT INTO public.courses (id, slug, title, source) VALUES ('crs_Settings0001', 'pgtap-settings-hub', 'Hub Course', 'hub');
INSERT INTO public.course_modules (id, course_id, parent_id, title, position, publishing_option, source) VALUES
  ('mod_SettingsA0001', 'crs_Settings0001', NULL, 'Module A', 1, 'published', 'hub'),
  ('mod_SettingsB0001', 'crs_Settings0001', NULL, 'Module B', 2, 'locked', 'hub'),
  ('mod_SettingsA1001', 'crs_Settings0001', 'mod_SettingsA0001', 'Week A1', 1, 'published', 'hub');
INSERT INTO public.course_lessons (id, course_id, module_id, title, position, publishing_option, source) VALUES
  ('les_SettingsA1L01', 'crs_Settings0001', 'mod_SettingsA1001', 'Lesson in A1', 1, 'published', 'hub'),
  ('les_SettingsAOwn1', 'crs_Settings0001', 'mod_SettingsA0001', 'Own published in A', 1, 'published', 'hub'),
  ('les_SettingsB0L01', 'crs_Settings0001', 'mod_SettingsB0001', 'Lesson in B', 1, 'locked', 'hub'),
  ('les_SettingsLoose', 'crs_Settings0001', NULL, 'Loose lesson', 1, 'published', 'hub');

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

SELECT is(pg_temp.states(),
  '{"mod_SettingsA0001":"open","mod_SettingsB0001":"coming_soon","mod_SettingsA1001":"open","les_SettingsA1L01":"open","les_SettingsAOwn1":"open","les_SettingsB0L01":"coming_soon","les_SettingsLoose":"open"}'::jsonb,
  'what is added follows nothing above it: open, and a locked module and what follows it coming soon (added with its state worked out)');
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
INSERT INTO result SELECT 'member_item', to_jsonb(pg_temp.failure($$SELECT public.set_course_item_status('module', 'mod_SettingsA0001', 'published')$$));

-- Dana (an admin).
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000e2a4", "email": "settings-dana@example.test", "role": "authenticated"}', true);

-- Marking items published changes nothing that is already open.
SELECT public.set_course_item_status('module', 'mod_SettingsA0001', 'published');
SELECT public.set_course_item_status('lesson', 'les_SettingsLoose', 'published');
INSERT INTO result SELECT 'marked_published', pg_temp.states();
INSERT INTO result SELECT 'unsupported_drip', to_jsonb(pg_temp.failure($$SELECT public.set_course_item_status('lesson', 'les_SettingsLoose', 'drip')$$));
INSERT INTO result SELECT 'unsupported_scheduled', to_jsonb(pg_temp.failure($$SELECT public.set_course_item_status('lesson', 'les_SettingsLoose', 'scheduled')$$));
INSERT INTO result SELECT 'unsupported_inherit', to_jsonb(pg_temp.failure($$SELECT public.set_course_item_status('lesson', 'les_SettingsLoose', 'inherit')$$));
INSERT INTO result SELECT 'unknown_kind', to_jsonb(pg_temp.failure($$SELECT public.set_course_item_status('chapter', 'mod_SettingsA0001', 'draft')$$));
INSERT INTO result SELECT 'not_found', to_jsonb(pg_temp.failure($$SELECT public.set_course_item_status('lesson', 'les_Nope00000001', 'draft')$$));
INSERT INTO result SELECT 'imported_item', to_jsonb(pg_temp.failure($$SELECT public.set_course_item_status('lesson', 'les_SettingsKaj01', 'draft')$$));

-- A draft module hides what is under it, including what has its own published setting.
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
-- Published again: the module opens, and what it holds with it.
SELECT public.set_course_item_status('module', 'mod_SettingsA0001', 'published');
INSERT INTO result SELECT 'module_a_published_again', pg_temp.states();
-- A setting set to what it already is changes nothing.
SELECT public.set_course_item_status('module', 'mod_SettingsA0001', 'published');

-- A new published item is open straight away, and a copy is a draft.
INSERT INTO public.course_lessons (id, course_id, module_id, title, position, publishing_option, source) VALUES ('les_SettingsNew001', 'crs_Settings0001', 'mod_SettingsA0001', 'Added later', 9, 'published', 'hub');
INSERT INTO result SELECT 'added_to_published_course', to_jsonb((SELECT state FROM public.course_lessons WHERE id = 'les_SettingsNew001'));
SELECT public.duplicate_course_lesson('les_SettingsNew001');
INSERT INTO result SELECT 'copy_is_draft', to_jsonb((SELECT publishing_option || ':' || state FROM public.course_lessons WHERE title = 'Added later (copy)'));
RESET ROLE;

-- The Kajabi sync (the service role) writes imported rows as it likes; an inserted imported row keeps the state it was given.
INSERT INTO public.course_modules (id, course_id, title, position, publishing_option, state, source, source_key) VALUES
  ('mod_SettingsKaj02', 'crs_SettingsKaj01', 'Imported 2', 2, 'draft', 'open', 'kajabi', 'pgtap-settings-km2');
SELECT is((SELECT value FROM result WHERE label = 'member_item'), '"not_editable"'::jsonb, 'a member can''t change an item''s setting');
SELECT is((SELECT value FROM result WHERE label = 'marked_published'),
  '{"mod_SettingsA0001":"open","mod_SettingsB0001":"coming_soon","mod_SettingsA1001":"open","les_SettingsA1L01":"open","les_SettingsAOwn1":"open","les_SettingsB0L01":"coming_soon","les_SettingsLoose":"open"}'::jsonb,
  'a module and a lesson can be marked published');
SELECT is((SELECT value FROM result WHERE label = 'unsupported_drip'), '"unsupported_status"'::jsonb, 'drip isn''t offered yet');
SELECT is((SELECT value FROM result WHERE label = 'unsupported_scheduled'), '"unsupported_status"'::jsonb, 'nor scheduled');
SELECT is((SELECT value FROM result WHERE label = 'unsupported_inherit'), '"unsupported_status"'::jsonb, 'following what is above is no longer a setting');
SELECT is((SELECT value FROM result WHERE label = 'unknown_kind'), '"unknown_kind"'::jsonb, 'an unknown kind is refused');
SELECT is((SELECT value FROM result WHERE label = 'not_found'), '"not_found"'::jsonb, 'an item that isn''t there is not found');
SELECT is((SELECT value FROM result WHERE label = 'imported_item'), '"not_editable"'::jsonb, 'an imported item can''t be changed');
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
SELECT is((SELECT value FROM result WHERE label = 'module_a_published_again'),
  '{"mod_SettingsA0001":"open","mod_SettingsB0001":"coming_soon","mod_SettingsA1001":"open","les_SettingsA1L01":"open","les_SettingsAOwn1":"open","les_SettingsB0L01":"coming_soon","les_SettingsLoose":"open"}'::jsonb,
  'a module published again opens, and what it holds with it');
SELECT is((SELECT value FROM result WHERE label = 'added_to_published_course'), '"open"'::jsonb, 'a lesson added as published is open');
SELECT is((SELECT value FROM result WHERE label = 'copy_is_draft'), '"draft:hidden"'::jsonb, 'a copy is a draft');
SELECT is((SELECT state FROM public.course_modules WHERE id = 'mod_SettingsKaj02'), 'open', 'an imported row keeps the state the sync gave it');

-- Audit: a setting changed is one entry for the thing changed; the states that follow are not entries.
SELECT is(
  (SELECT jsonb_build_object('who', changed_by, 'kind', actor_kind, 'label', entity_label, 'changes', changes - 'updated_at')
     FROM public.audit_log WHERE entity_type = 'course_lesson' AND entity_id = 'les_SettingsB0L01' AND action = 'update'),
  jsonb_build_object('who', '00000000-0000-4000-a000-00000000e2a4', 'kind', 'staff', 'label', 'Lesson in B',
    'changes', '{"publishing_option": {"old": "locked", "new": "published"}}'::jsonb),
  'changing a lesson''s setting is one entry for that lesson, as the admin, with the setting before and after (and not its state)');
SELECT is(
  (SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'course_module' AND entity_id = 'mod_SettingsA0001' AND action = 'update'),
  0, 'a module set to draft and back to published in one transaction nets out to nothing: no entry for an intent that cancelled itself');
SELECT is(
  (SELECT count(*)::int FROM public.audit_log WHERE entity_type IN ('course_module', 'course_lesson') AND action = 'update' AND changes ? 'state'),
  0, 'a state that only follows a setting is never an entry of its own');
SELECT * FROM finish(true);
ROLLBACK;
