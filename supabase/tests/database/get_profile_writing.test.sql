-- pgTAP test for public.get_profile_writing (20260928000400_writing_goal_details_and_profile.sql).
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched.
-- Run with `npm run test:pgtap` (scripts/test-pgtap.sh; CI runs it in the test-db job). It runs
-- as supabase_admin, since tests here SET ROLE to roles postgres can't. finish(true) raises on
-- any "not ok", so a failed assertion fails the run.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(11);

-- Writer (whose profile is viewed) and a regular member viewing it. Fixed ids nothing else uses.
INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('00000000-0000-4000-a000-00000000b901', 'Profile Writer', 'profile-writer@example.test', now(), 'active'),
  ('00000000-0000-4000-a000-00000000b902', 'Profile Viewer', 'profile-viewer@example.test', now(), 'active');

INSERT INTO public.writing_projects (id, member_id, title, show_on_profile) VALUES
  ('00000000-0000-4000-a000-00000000b911', '00000000-0000-4000-a000-00000000b901', 'Shown project', true),
  ('00000000-0000-4000-a000-00000000b912', '00000000-0000-4000-a000-00000000b901', 'Hidden project with shown goal', false),
  ('00000000-0000-4000-a000-00000000b913', '00000000-0000-4000-a000-00000000b901', 'Fully private', false);

INSERT INTO public.writing_progress_entries (member_id, project_id, entry_date, measure, mode, amount, note, tags) VALUES
  ('00000000-0000-4000-a000-00000000b901', '00000000-0000-4000-a000-00000000b911', '2026-01-02', 'words', 'delta', 1000, 'secret note', '{private}'),
  ('00000000-0000-4000-a000-00000000b901', '00000000-0000-4000-a000-00000000b912', '2026-01-03', 'chapters', 'delta', 2, NULL, '{}'),
  ('00000000-0000-4000-a000-00000000b901', '00000000-0000-4000-a000-00000000b913', '2026-01-04', 'words', 'delta', 500, NULL, '{}');

INSERT INTO public.writing_project_starting_balances (member_id, project_id, measure, amount) VALUES
  ('00000000-0000-4000-a000-00000000b901', '00000000-0000-4000-a000-00000000b911', 'words', 24657),
  ('00000000-0000-4000-a000-00000000b901', '00000000-0000-4000-a000-00000000b913', 'words', 999);

INSERT INTO public.writing_goals (member_id, project_id, goal_type, measure, target_amount, title, description, show_on_profile) VALUES
  ('00000000-0000-4000-a000-00000000b901', '00000000-0000-4000-a000-00000000b912', 'target', 'chapters', 18, 'Finish Draft 3', 'For beta readers', true),
  ('00000000-0000-4000-a000-00000000b901', '00000000-0000-4000-a000-00000000b913', 'target', 'words', 1000, 'Private goal', NULL, false);

-- Call it as a signed-in regular member, the way PostgREST does.
CREATE TEMP TABLE profile_result(label text, result jsonb) ON COMMIT DROP;
GRANT INSERT ON profile_result TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000b999", "email": "profile-viewer@example.test", "role": "authenticated"}', true);
INSERT INTO profile_result
SELECT 'viewer', public.get_profile_writing('00000000-0000-4000-a000-00000000b901');
-- Plain table reads as the same viewer stay owner-only.
INSERT INTO profile_result
SELECT 'direct', to_jsonb(count(*)) FROM public.writing_projects WHERE member_id = '00000000-0000-4000-a000-00000000b901';
SELECT set_config('request.jwt.claims', '{"role": "authenticated"}', true);
INSERT INTO profile_result
SELECT 'no_user', public.get_profile_writing('00000000-0000-4000-a000-00000000b901');
RESET ROLE;

SELECT is(
  (SELECT jsonb_path_query_array(result, '$.projects[*].title') FROM profile_result WHERE label = 'viewer'),
  '["Shown project"]'::jsonb, 'only the opted-in project is listed');
SELECT is(
  (SELECT jsonb_path_query_array(result, '$.goals[*].title') FROM profile_result WHERE label = 'viewer'),
  '["Finish Draft 3"]'::jsonb, 'only the opted-in goal is listed');
SELECT is(
  (SELECT result #>> '{goals,0,project_title}' FROM profile_result WHERE label = 'viewer'),
  'Hidden project with shown goal', 'a shown goal carries its project title');
SELECT is(
  (SELECT result #>> '{goals,0,description}' FROM profile_result WHERE label = 'viewer'),
  'For beta readers', 'a shown goal carries its description');
SELECT is(
  (SELECT jsonb_array_length(result -> 'entries') FROM profile_result WHERE label = 'viewer'),
  2, 'entries come from the shown project and the shown goal''s project only');
SELECT ok(
  (SELECT NOT (result::text LIKE '%secret note%' OR result::text LIKE '%private%') FROM profile_result WHERE label = 'viewer'),
  'entry notes and tags are never returned');
SELECT ok(
  (SELECT NOT (result -> 'entries' -> 0 ? 'note') FROM profile_result WHERE label = 'viewer'),
  'entries have no note key');
SELECT is(
  (SELECT jsonb_path_query_array(result, '$.starting_balances[*].amount') FROM profile_result WHERE label = 'viewer'),
  '[24657]'::jsonb, 'starting balances only for shown projects');
SELECT is(
  (SELECT result FROM profile_result WHERE label = 'direct'),
  '0'::jsonb, 'a regular member still can''t read another member''s writing_projects directly');
SELECT is(
  (SELECT result FROM profile_result WHERE label = 'no_user'),
  NULL, 'no signed-in user → NULL');
SELECT ok(
  NOT has_function_privilege('anon', 'public.get_profile_writing(uuid)', 'EXECUTE'),
  'anon can''t call it');

SELECT * FROM finish(true);
ROLLBACK;
