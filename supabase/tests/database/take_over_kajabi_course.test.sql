-- pgTAP tests for taking a course over from Kajabi (20270415000000): an imported course becomes a Hub-owned one,
-- keeping its ids, with a setting the editor knows on every item, and the audit log records one entry for the
-- course instead of one per module and lesson. Runs in one transaction that is rolled back, so it leaves the shared
-- local DB untouched. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(17);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000e3a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'takeover-alice@example.test'),
  ('00000000-0000-4000-a000-00000000e3a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'takeover-dana@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000e3a1', 'takeover-alice@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000e3a4', 'takeover-dana@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

-- An imported course: module A (published, open) with submodule A1 (locked, so coming soon) and lessons in each,
-- a module with no setting, and a lesson with a setting the editor doesn't use.
INSERT INTO public.courses (id, slug, title, source, source_key, is_draft) VALUES ('crs_TakeOver0001', 'pgtap-takeover', 'Imported', 'kajabi', 'pgtap-takeover-k', false);
INSERT INTO public.course_modules (id, course_id, parent_id, title, position, publishing_option, state, source, source_key) VALUES
  ('mod_TakeOverA001', 'crs_TakeOver0001', NULL, 'Module A', 1, 'published', 'open', 'kajabi', 'pgtap-takeover-ma'),
  ('mod_TakeOverA101', 'crs_TakeOver0001', 'mod_TakeOverA001', 'Week A1', 1, 'locked', 'coming_soon', 'kajabi', 'pgtap-takeover-ma1'),
  ('mod_TakeOverN001', 'crs_TakeOver0001', NULL, 'No setting', 2, NULL, 'hidden', 'kajabi', 'pgtap-takeover-mn');
INSERT INTO public.course_lessons (id, course_id, module_id, title, position, publishing_option, state, source, source_key) VALUES
  ('les_TakeOverA001', 'crs_TakeOver0001', 'mod_TakeOverA001', 'Open lesson', 1, 'published', 'open', 'kajabi', 'pgtap-takeover-la'),
  ('les_TakeOverA101', 'crs_TakeOver0001', 'mod_TakeOverA101', 'Soon lesson', 1, 'published', 'coming_soon', 'kajabi', 'pgtap-takeover-la1'),
  ('les_TakeOverW001', 'crs_TakeOver0001', 'mod_TakeOverN001', 'Weird setting', 1, 'weird', 'hidden', 'kajabi', 'pgtap-takeover-lw');

-- A course nested one level too deep for the editor, a Hub-owned course, and a course taken over twice.
INSERT INTO public.courses (id, slug, title, source, source_key) VALUES
  ('crs_TakeOverDeep', 'pgtap-takeover-deep', 'Deep', 'kajabi', 'pgtap-takeover-deep-k'),
  ('crs_TakeOverHub1', 'pgtap-takeover-hub', 'Hub', 'hub', NULL);
INSERT INTO public.course_modules (id, course_id, parent_id, title, position, publishing_option, state, source, source_key) VALUES
  ('mod_TakeOverD001', 'crs_TakeOverDeep', NULL, 'D1', 1, 'published', 'open', 'kajabi', 'pgtap-takeover-d1'),
  ('mod_TakeOverD002', 'crs_TakeOverDeep', 'mod_TakeOverD001', 'D2', 1, 'published', 'open', 'kajabi', 'pgtap-takeover-d2'),
  ('mod_TakeOverD003', 'crs_TakeOverDeep', 'mod_TakeOverD002', 'D3', 1, 'published', 'open', 'kajabi', 'pgtap-takeover-d3');

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

-- Alice (a member) can take nothing over.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000e3a1", "email": "takeover-alice@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'member', to_jsonb(pg_temp.failure($$SELECT public.take_over_kajabi_course('crs_TakeOver0001')$$));

-- Dana (an admin).
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000e3a4", "email": "takeover-dana@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'unknown', to_jsonb(pg_temp.failure($$SELECT public.take_over_kajabi_course('crs_Nope00000001')$$));
INSERT INTO result SELECT 'hub_owned', to_jsonb(pg_temp.failure($$SELECT public.take_over_kajabi_course('crs_TakeOverHub1')$$));
INSERT INTO result SELECT 'too_deep', to_jsonb(pg_temp.failure($$SELECT public.take_over_kajabi_course('crs_TakeOverDeep')$$));
SELECT public.take_over_kajabi_course('crs_TakeOver0001');
INSERT INTO result SELECT 'again', to_jsonb(pg_temp.failure($$SELECT public.take_over_kajabi_course('crs_TakeOver0001')$$));
-- The editor can change it now: it is theirs.
SELECT public.set_course_item_status('lesson', 'les_TakeOverW001', 'published');
RESET ROLE;

SELECT is((SELECT value FROM result WHERE label = 'member'), '"not_editable"'::jsonb, 'a member can''t take a course over');
SELECT is((SELECT value FROM result WHERE label = 'unknown'), '"not_found"'::jsonb, 'a course that isn''t there is not found');
SELECT is((SELECT value FROM result WHERE label = 'hub_owned'), '"not_editable"'::jsonb, 'a course the Hub already owns has nothing to take over');
SELECT is((SELECT value FROM result WHERE label = 'too_deep'), '"too_deep"'::jsonb, 'modules nested deeper than the editor does are refused');
SELECT is((SELECT source FROM public.courses WHERE id = 'crs_TakeOverDeep'), 'kajabi', 'and that course is left as it was');
SELECT is((SELECT value FROM result WHERE label = 'again'), '"not_editable"'::jsonb, 'a course taken over can''t be taken over again');

SELECT is((SELECT source FROM public.courses WHERE id = 'crs_TakeOver0001'), 'hub', 'the course is Hub-owned');
SELECT is((SELECT source_key FROM public.courses WHERE id = 'crs_TakeOver0001'), 'pgtap-takeover-k', 'and keeps its Kajabi key, so the import knows it was taken over');
SELECT is((SELECT count(*)::int FROM public.course_modules WHERE course_id = 'crs_TakeOver0001' AND source <> 'hub'), 0, 'every module is Hub-owned');
SELECT is((SELECT count(*)::int FROM public.course_lessons WHERE course_id = 'crs_TakeOver0001' AND source <> 'hub'), 0, 'every lesson is Hub-owned');
SELECT is((SELECT count(*)::int FROM public.course_lessons WHERE course_id = 'crs_TakeOver0001'), 3, 'nothing was added or removed');

SELECT is((SELECT publishing_option FROM public.course_modules WHERE id = 'mod_TakeOverN001'), 'draft', 'a module with no setting becomes a draft');
SELECT is((SELECT publishing_option FROM public.course_lessons WHERE id = 'les_TakeOverW001'), 'published', 'and the editor can set a lesson that had a setting it doesn''t use');
SELECT is(
  (SELECT jsonb_object_agg(id, state) FROM (
    SELECT id, state FROM public.course_modules WHERE course_id = 'crs_TakeOver0001'
    UNION ALL SELECT id, state FROM public.course_lessons WHERE course_id = 'crs_TakeOver0001') s),
  '{"mod_TakeOverA001":"open","mod_TakeOverA101":"coming_soon","mod_TakeOverN001":"hidden","les_TakeOverA001":"open","les_TakeOverA101":"coming_soon","les_TakeOverW001":"hidden"}'::jsonb,
  'what members see is what it was (the weird lesson is in a draft module, so still hidden)');

SELECT is(
  (SELECT jsonb_build_object('who', changed_by, 'kind', actor_kind, 'label', entity_label, 'changes', changes - 'updated_at')
     FROM public.audit_log WHERE entity_type = 'course' AND entity_id = 'crs_TakeOver0001' AND action = 'update'),
  jsonb_build_object('who', '00000000-0000-4000-a000-00000000e3a4', 'kind', 'staff', 'label', 'Imported', 'changes', '{"source": {"old": "kajabi", "new": "hub"}}'::jsonb),
  'the course has one audit entry, as the admin, saying it was taken over');
SELECT is(
  (SELECT count(*)::int FROM public.audit_log WHERE entity_type IN ('course_module', 'course_lesson') AND entity_id IN
     ('mod_TakeOverA001', 'mod_TakeOverA101', 'mod_TakeOverN001', 'les_TakeOverA001', 'les_TakeOverA101', 'mod_TakeOverD001') AND action = 'update'),
  0, 'and none for the modules and lessons that came with it');
SELECT is(
  (SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'course_lesson' AND entity_id = 'les_TakeOverW001' AND action = 'update'),
  1, 'while a change made after it is an entry of its own');

SELECT * FROM finish(true);
ROLLBACK;
