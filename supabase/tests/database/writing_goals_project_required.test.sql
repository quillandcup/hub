-- pgTAP test for 20270815000000: a writing goal always belongs to a project. The column refuses a goal with no
-- project, whether inserted or changed to have none. Runs in one transaction that is rolled back, so it leaves
-- the shared local DB untouched. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(4);

INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('mbr_GoalReqAlic1', 'Goal Required Alice', 'goalreq-alice@example.test', now(), 'active');
INSERT INTO public.writing_projects (id, member_id, title) VALUES ('prj_GoalReqP0001', 'mbr_GoalReqAlic1', 'Project 1');

SELECT is(
  (SELECT is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'writing_goals' AND column_name = 'project_id'),
  'NO', 'the project of a goal is required');

SELECT lives_ok(
  $$INSERT INTO public.writing_goals (id, member_id, project_id, goal_type, measure, target_amount) VALUES ('00000000-0000-4000-b100-000000000001', 'mbr_GoalReqAlic1', 'prj_GoalReqP0001', 'target', 'words', 100)$$,
  'a goal with a project is saved');

SELECT throws_ok(
  $$INSERT INTO public.writing_goals (member_id, project_id, goal_type, measure, target_amount) VALUES ('mbr_GoalReqAlic1', NULL, 'target', 'words', 100)$$,
  '23502', NULL, 'a goal with no project is refused');

SELECT throws_ok(
  $$UPDATE public.writing_goals SET project_id = NULL WHERE id = '00000000-0000-4000-b100-000000000001'$$,
  '23502', NULL, 'and a goal can''t be changed to have none');

SELECT * FROM finish(true);
ROLLBACK;
