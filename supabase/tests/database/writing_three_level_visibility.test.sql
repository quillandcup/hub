-- pgTAP test for the three-level visibility on writing projects and goals
-- (20270831000000_writing_three_level_visibility.sql). Rolled back, so it leaves the local DB untouched.
-- Run with `pnpm test:pgtap`. It covers: the two columns staying together whichever one a write names, the CHECK,
-- a goal never above its project, hiding a project keeping its goals' own setting, and get_profile_writing listing
-- exactly what members see today (everything that is not private) and nothing for a private item.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(30);

INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('mbr_AAAAAAAAc9A1', 'Visibility Writer', 'visibility-writer@example.test', now(), 'active'),
  ('mbr_AAAAAAAAc9A2', 'Visibility Viewer', 'visibility-viewer@example.test', now(), 'active'),
  ('mbr_AAAAAAAAc9A3', 'Order Writer', 'order-writer@example.test', now(), 'active');

-- Projects: how a new row's two columns settle ------------------------------------------------------------------
INSERT INTO public.writing_projects (id, member_id, title) VALUES
  ('prj_AAAAAAAAc911', 'mbr_AAAAAAAAc9A1', 'Default project');
INSERT INTO public.writing_projects (id, member_id, title, show_on_profile) VALUES
  ('prj_AAAAAAAAc912', 'mbr_AAAAAAAAc9A1', 'Old flag off', false);
INSERT INTO public.writing_projects (id, member_id, title, visibility) VALUES
  ('prj_AAAAAAAAc913', 'mbr_AAAAAAAAc9A1', 'Public project', 'public'),
  ('prj_AAAAAAAAc914', 'mbr_AAAAAAAAc9A1', 'Private project', 'private');

SELECT is((SELECT visibility || '/' || show_on_profile FROM public.writing_projects WHERE id = 'prj_AAAAAAAAc911'),
  'community/true', 'a new project is visible to members by default, as before');
SELECT is((SELECT visibility || '/' || show_on_profile FROM public.writing_projects WHERE id = 'prj_AAAAAAAAc912'),
  'private/false', 'a new project written with the old flag off is private');
SELECT is((SELECT visibility || '/' || show_on_profile FROM public.writing_projects WHERE id = 'prj_AAAAAAAAc913'),
  'public/true', 'a new project written as public is shown');
SELECT is((SELECT visibility || '/' || show_on_profile FROM public.writing_projects WHERE id = 'prj_AAAAAAAAc914'),
  'private/false', 'a new project written as private is not shown, whatever the flag default says');

SELECT throws_ok(
  $$INSERT INTO public.writing_projects (id, member_id, title, visibility) VALUES ('prj_AAAAAAAAc919', 'mbr_AAAAAAAAc9A1', 'Bad', 'everyone')$$,
  '23514', NULL, 'a project level outside private, community and public is refused');
SELECT throws_ok(
  $$INSERT INTO public.writing_goals (member_id, project_id, goal_type, measure, target_amount, visibility) VALUES ('mbr_AAAAAAAAc9A1', 'prj_AAAAAAAAc911', 'target', 'words', 1, 'everyone')$$,
  '23514', NULL, 'a goal level outside private, community and public is refused');

-- Projects: updates through either column ---------------------------------------------------------------------
UPDATE public.writing_projects SET visibility = 'public' WHERE id = 'prj_AAAAAAAAc911';
SELECT is((SELECT visibility || '/' || show_on_profile FROM public.writing_projects WHERE id = 'prj_AAAAAAAAc911'),
  'public/true', 'writing the level sets the flag');
UPDATE public.writing_projects SET show_on_profile = true WHERE id = 'prj_AAAAAAAAc911';
SELECT is((SELECT visibility FROM public.writing_projects WHERE id = 'prj_AAAAAAAAc911'),
  'public', 'writing the flag it already has does not lower a public project');
UPDATE public.writing_projects SET show_on_profile = false WHERE id = 'prj_AAAAAAAAc911';
SELECT is((SELECT visibility || '/' || show_on_profile FROM public.writing_projects WHERE id = 'prj_AAAAAAAAc911'),
  'private/false', 'turning the old flag off makes the project private');
UPDATE public.writing_projects SET show_on_profile = true WHERE id = 'prj_AAAAAAAAc911';
SELECT is((SELECT visibility FROM public.writing_projects WHERE id = 'prj_AAAAAAAAc911'),
  'community', 'turning the old flag on makes a private project visible to members, never public');
UPDATE public.writing_projects SET title = 'Renamed' WHERE id = 'prj_AAAAAAAAc913';
SELECT is((SELECT visibility FROM public.writing_projects WHERE id = 'prj_AAAAAAAAc913'),
  'public', 'an unrelated update leaves the level alone');

-- Goals: how a new row settles, and never above the project ----------------------------------------------------
INSERT INTO public.writing_goals (id, member_id, project_id, goal_type, measure, target_amount, title) VALUES
  ('00000000-0000-4000-a000-00000000c911', 'mbr_AAAAAAAAc9A1', 'prj_AAAAAAAAc911', 'target', 'words', 100, 'Default goal');
INSERT INTO public.writing_goals (id, member_id, project_id, goal_type, measure, target_amount, title, show_on_profile) VALUES
  ('00000000-0000-4000-a000-00000000c912', 'mbr_AAAAAAAAc9A1', 'prj_AAAAAAAAc911', 'target', 'words', 100, 'Old flag on', true);
INSERT INTO public.writing_goals (id, member_id, project_id, goal_type, measure, target_amount, title, visibility) VALUES
  ('00000000-0000-4000-a000-00000000c913', 'mbr_AAAAAAAAc9A1', 'prj_AAAAAAAAc913', 'target', 'words', 100, 'Public goal on public project', 'public'),
  ('00000000-0000-4000-a000-00000000c914', 'mbr_AAAAAAAAc9A1', 'prj_AAAAAAAAc914', 'target', 'words', 100, 'Wants to be public on a private project', 'public'),
  ('00000000-0000-4000-a000-00000000c915', 'mbr_AAAAAAAAc9A1', 'prj_AAAAAAAAc911', 'target', 'words', 100, 'Wants to be public on a community project', 'public');

SELECT is((SELECT visibility || '/' || show_on_profile FROM public.writing_goals WHERE id = '00000000-0000-4000-a000-00000000c911'),
  'private/false', 'a new goal is private by default');
SELECT is((SELECT visibility || '/' || show_on_profile FROM public.writing_goals WHERE id = '00000000-0000-4000-a000-00000000c912'),
  'community/true', 'a new goal written with the old flag on is visible to members');
SELECT is((SELECT visibility || '/' || show_on_profile FROM public.writing_goals WHERE id = '00000000-0000-4000-a000-00000000c913'),
  'public/true', 'a goal can be public on a public project');
SELECT is((SELECT visibility || '/' || show_on_profile FROM public.writing_goals WHERE id = '00000000-0000-4000-a000-00000000c914'),
  'private/false', 'a goal is clamped to a private project: private');
SELECT is((SELECT visibility || '/' || show_on_profile FROM public.writing_goals WHERE id = '00000000-0000-4000-a000-00000000c915'),
  'community/true', 'a goal is clamped to a community project: community');
UPDATE public.writing_goals SET visibility = 'public' WHERE id = '00000000-0000-4000-a000-00000000c912';
SELECT is((SELECT visibility FROM public.writing_goals WHERE id = '00000000-0000-4000-a000-00000000c912'),
  'community', 'raising a goal above its project on update is clamped too');
UPDATE public.writing_goals SET show_on_profile = false WHERE id = '00000000-0000-4000-a000-00000000c912';
SELECT is((SELECT visibility || '/' || show_on_profile FROM public.writing_goals WHERE id = '00000000-0000-4000-a000-00000000c912'),
  'private/false', 'turning a goal''s old flag off makes it private');

-- Hiding a project keeps its goals' own setting, and the profile reads the lower of the two ---------------------
UPDATE public.writing_projects SET visibility = 'private' WHERE id = 'prj_AAAAAAAAc913';
SELECT is((SELECT visibility FROM public.writing_goals WHERE id = '00000000-0000-4000-a000-00000000c913'),
  'public', 'making a project private leaves its goal''s own level alone');

-- get_profile_writing: what members see today (not private), nothing for a private item -------------------------
CREATE TEMP TABLE profile_result(label text, result jsonb) ON COMMIT DROP;
GRANT INSERT ON profile_result TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000c999", "email": "visibility-viewer@example.test", "role": "authenticated"}', true);
INSERT INTO profile_result SELECT 'private_project', public.get_profile_writing('mbr_AAAAAAAAc9A1');
RESET ROLE;
SELECT is(
  (SELECT jsonb_path_query_array(result, '$.projects[*].title') FROM profile_result WHERE label = 'private_project'),
  '["Default project"]'::jsonb, 'the profile lists the project that is visible to members and no private one');
SELECT is(
  (SELECT jsonb_path_query_array(result, '$.goals[*].title') FROM profile_result WHERE label = 'private_project'),
  '["Wants to be public on a community project"]'::jsonb,
  'the profile lists a goal only when it and its project are both not private (the public goal of a private project is left out)');

UPDATE public.writing_projects SET visibility = 'community' WHERE id = 'prj_AAAAAAAAc913';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000c999", "email": "visibility-viewer@example.test", "role": "authenticated"}', true);
INSERT INTO profile_result SELECT 'back_to_community', public.get_profile_writing('mbr_AAAAAAAAc9A1');
RESET ROLE;
SELECT is(
  (SELECT jsonb_path_query_array(result, '$.goals[*].title') FROM profile_result WHERE label = 'back_to_community'),
  '["Public goal on public project", "Wants to be public on a community project"]'::jsonb,
  'raising the project again brings the goal back, and public items are listed like community ones (nothing is open to the internet yet)');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role": "authenticated"}', true);
INSERT INTO profile_result SELECT 'no_user', public.get_profile_writing('mbr_AAAAAAAAc9A1');
RESET ROLE;
SELECT is((SELECT result FROM profile_result WHERE label = 'no_user'), NULL::jsonb,
  'a caller with no signed-in member gets nothing, public items included');

-- Signed-out callers have no access to the new helpers or to anything public ------------------------------------
SELECT ok(NOT has_function_privilege('anon', 'public.writing_visibility_rank(text)', 'EXECUTE'),
  'the signed-out role cannot run the rank helper');
SELECT is(public.writing_visibility_rank('private') < public.writing_visibility_rank('community')
  AND public.writing_visibility_rank('community') < public.writing_visibility_rank('public'), true,
  'private < community < public');

-- The profile lists projects and goals in the member's own order, whichever plan the database picks ------------------
-- Creation order, title order and the member's placement all differ here, so the order that wins is the product one:
-- projects never placed first (newest first), goals by their project in that order, then the placed ones before the
-- ones never placed. (This used to come from jsonb_agg with no ORDER BY, so a different join strategy swapped it.)
INSERT INTO public.writing_projects (id, member_id, title, created_at) VALUES
  ('prj_AAAAAAAAc921', 'mbr_AAAAAAAAc9A3', 'Apple project', now() - interval '2 days'),
  ('prj_AAAAAAAAc922', 'mbr_AAAAAAAAc9A3', 'Zebra project', now() - interval '1 day');
INSERT INTO public.writing_goals (id, member_id, project_id, goal_type, measure, target_amount, title, sort_position, visibility) VALUES
  ('00000000-0000-4000-a000-00000000c931', 'mbr_AAAAAAAAc9A3', 'prj_AAAAAAAAc921', 'target', 'words', 100, 'Alpha goal never placed', NULL, 'community'),
  ('00000000-0000-4000-a000-00000000c932', 'mbr_AAAAAAAAc9A3', 'prj_AAAAAAAAc921', 'target', 'words', 100, 'Zulu goal placed first', 1, 'community'),
  ('00000000-0000-4000-a000-00000000c933', 'mbr_AAAAAAAAc9A3', 'prj_AAAAAAAAc922', 'target', 'words', 100, 'Mid goal in the newer project', NULL, 'community');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000c999", "email": "visibility-viewer@example.test", "role": "authenticated"}', true);
INSERT INTO profile_result SELECT 'order_default', public.get_profile_writing('mbr_AAAAAAAAc9A3');
SET LOCAL enable_hashjoin = off;
SET LOCAL enable_mergejoin = off;
INSERT INTO profile_result SELECT 'order_nestloop', public.get_profile_writing('mbr_AAAAAAAAc9A3');
RESET enable_hashjoin;
SET LOCAL enable_nestloop = off;
SET LOCAL enable_mergejoin = off;
INSERT INTO profile_result SELECT 'order_hashjoin', public.get_profile_writing('mbr_AAAAAAAAc9A3');
RESET enable_nestloop;
RESET enable_mergejoin;
RESET ROLE;

SELECT is(
  (SELECT jsonb_path_query_array(result, '$.projects[*].title') FROM profile_result WHERE label = 'order_default'),
  '["Zebra project", "Apple project"]'::jsonb, 'projects never placed are listed newest first');
SELECT is(
  (SELECT jsonb_path_query_array(result, '$.goals[*].title') FROM profile_result WHERE label = 'order_default'),
  '["Mid goal in the newer project", "Zulu goal placed first", "Alpha goal never placed"]'::jsonb,
  'goals follow their project''s place, then the member''s own placement, with unplaced goals last');
SELECT is(
  (SELECT jsonb_path_query_array(result, '$.goals[*].title') FROM profile_result WHERE label = 'order_nestloop'),
  (SELECT jsonb_path_query_array(result, '$.goals[*].title') FROM profile_result WHERE label = 'order_default'),
  'the goal order is the same when the planner joins with nested loops');
SELECT is(
  (SELECT jsonb_path_query_array(result, '$.goals[*].title') FROM profile_result WHERE label = 'order_hashjoin'),
  (SELECT jsonb_path_query_array(result, '$.goals[*].title') FROM profile_result WHERE label = 'order_default'),
  'the goal order is the same when the planner joins with hash joins');
SELECT is(
  (SELECT jsonb_path_query_array(result, '$.projects[*].title') FROM profile_result WHERE label = 'order_nestloop'),
  (SELECT jsonb_path_query_array(result, '$.projects[*].title') FROM profile_result WHERE label = 'order_default'),
  'the project order is the same under another plan');

SELECT * FROM finish(true);
ROLLBACK;
