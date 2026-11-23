-- pgTAP tests for reorder_writing_goals (20270811000000): a member puts the goals of one of their projects in an
-- order of their choosing in one statement; ids that aren't that project's live, unarchived goals of theirs are
-- ignored; nobody can reorder another member's goals except an admin (sudo acts through the admin's own session);
-- and a reorder is one entry in the audit log, not one per goal. Runs in one transaction that is rolled back, so it
-- leaves the shared local DB untouched. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(13);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000d2a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'goalorder-alice@example.test'),
  ('00000000-0000-4000-a000-00000000d2a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'goalorder-dana@example.test');
INSERT INTO public.user_profiles (id, email) VALUES
  ('00000000-0000-4000-a000-00000000d2a1', 'goalorder-alice@example.test'),
  ('00000000-0000-4000-a000-00000000d2a4', 'goalorder-dana@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-4000-a000-00000000d2a4', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;
INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('mbr_GoalOrdAlic1', 'Goal Order Alice', 'goalorder-alice@example.test', now(), 'active', '00000000-0000-4000-a000-00000000d2a1'),
  ('mbr_GoalOrdBob01', 'Goal Order Bob', 'goalorder-bob@example.test', now(), 'active', NULL);

INSERT INTO public.writing_projects (id, member_id, title) VALUES
  ('prj_GoalOrdP0001', 'mbr_GoalOrdAlic1', 'Project 1'),
  ('prj_GoalOrdP0002', 'mbr_GoalOrdAlic1', 'Project 2'),
  ('prj_GoalOrdB0001', 'mbr_GoalOrdBob01', 'Bob 1');

-- Alice's project 1 has goals 1, 2, 3 (by id), one archived and one deleted; project 2 has one; Bob has one.
INSERT INTO public.writing_goals (id, member_id, project_id, measure, target_amount, archived_at, deleted_at) VALUES
  ('00000000-0000-4000-b000-000000000001', 'mbr_GoalOrdAlic1', 'prj_GoalOrdP0001', 'words', 100, NULL, NULL),
  ('00000000-0000-4000-b000-000000000002', 'mbr_GoalOrdAlic1', 'prj_GoalOrdP0001', 'words', 100, NULL, NULL),
  ('00000000-0000-4000-b000-000000000003', 'mbr_GoalOrdAlic1', 'prj_GoalOrdP0001', 'words', 100, NULL, NULL),
  ('00000000-0000-4000-b000-000000000004', 'mbr_GoalOrdAlic1', 'prj_GoalOrdP0001', 'words', 100, now(), NULL),
  ('00000000-0000-4000-b000-000000000005', 'mbr_GoalOrdAlic1', 'prj_GoalOrdP0001', 'words', 100, NULL, now()),
  ('00000000-0000-4000-b000-000000000006', 'mbr_GoalOrdAlic1', 'prj_GoalOrdP0002', 'words', 100, NULL, NULL),
  ('00000000-0000-4000-b000-0000000000b1', 'mbr_GoalOrdBob01', 'prj_GoalOrdB0001', 'words', 100, NULL, NULL);

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;

CREATE FUNCTION pg_temp.failure(sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql;
  RETURN '';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.failure(text) TO authenticated;

SET LOCAL ROLE authenticated;

-- Alice reorders project 1's goals, with another project's goal, a stranger's, an archived one, a deleted one, a repeat and junk.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000d2a1", "email": "goalorder-alice@example.test", "role": "authenticated"}', true);
SELECT public.reorder_writing_goals('mbr_GoalOrdAlic1', 'prj_GoalOrdP0001', ARRAY[
  '00000000-0000-4000-b000-000000000003', '00000000-0000-4000-b000-0000000000b1', '00000000-0000-4000-b000-000000000006',
  '00000000-0000-4000-b000-000000000004', '00000000-0000-4000-b000-000000000005', 'not-a-uuid',
  '00000000-0000-4000-b000-000000000003', '00000000-0000-4000-b000-000000000001', '00000000-0000-4000-b000-000000000002']);
INSERT INTO result SELECT 'positions', to_jsonb(array_agg(right(id::text, 2) || '=' || coalesce(sort_position::text, 'null') ORDER BY id))
  FROM public.writing_goals;

-- The same list again changes nothing.
SELECT public.reorder_writing_goals('mbr_GoalOrdAlic1', 'prj_GoalOrdP0001', ARRAY[
  '00000000-0000-4000-b000-000000000003', '00000000-0000-4000-b000-000000000001', '00000000-0000-4000-b000-000000000002']);
INSERT INTO result SELECT 'positions_again', to_jsonb(array_agg(right(id::text, 2) || '=' || coalesce(sort_position::text, 'null') ORDER BY id))
  FROM public.writing_goals;

-- She can't reorder Bob's goals, and changing a goal is still audited.
INSERT INTO result SELECT 'other_member_message', to_jsonb(pg_temp.failure($$SELECT public.reorder_writing_goals('mbr_GoalOrdBob01', 'prj_GoalOrdB0001', ARRAY['00000000-0000-4000-b000-0000000000b1'])$$));
UPDATE public.writing_goals SET is_starred = true WHERE id = '00000000-0000-4000-b000-000000000002';

-- A caller with no claims is refused too.
SELECT set_config('request.jwt.claims', '', true);
INSERT INTO result SELECT 'signed_out_message', to_jsonb(pg_temp.failure($$SELECT public.reorder_writing_goals('mbr_GoalOrdAlic1', 'prj_GoalOrdP0001', ARRAY['00000000-0000-4000-b000-000000000001'])$$));

-- Dana, an admin (sudo works through her own session), reorders Alice's goals.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000d2a4", "email": "goalorder-dana@example.test", "role": "authenticated"}', true);
SELECT public.reorder_writing_goals('mbr_GoalOrdAlic1', 'prj_GoalOrdP0001', ARRAY[
  '00000000-0000-4000-b000-000000000002', '00000000-0000-4000-b000-000000000001', '00000000-0000-4000-b000-000000000003']);
RESET ROLE;

SELECT is((SELECT value FROM result WHERE label = 'positions'),
  '["01=2","02=3","03=1","04=null","05=null","06=null"]'::jsonb,
  'the project''s live, unarchived goals get 1..n in the given order (a repeat counts once); every other goal Alice can see is left alone');
SELECT is((SELECT value FROM result WHERE label = 'positions_again'), (SELECT value FROM result WHERE label = 'positions'), 'the same list again changes nothing');
SELECT is((SELECT value FROM result WHERE label = 'other_member_message'), '"not_allowed"'::jsonb, 'a member can''t reorder another member''s goals');
SELECT is((SELECT value FROM result WHERE label = 'signed_out_message'), '"not_allowed"'::jsonb, 'someone who isn''t signed in can''t reorder');
SELECT is((SELECT jsonb_agg(right(id::text, 2) ORDER BY sort_position) FROM public.writing_goals WHERE project_id = 'prj_GoalOrdP0001' AND sort_position IS NOT NULL),
  '["02","01","03"]'::jsonb, 'an admin can reorder a member''s goals');
SELECT is((SELECT sort_position FROM public.writing_goals WHERE id = '00000000-0000-4000-b000-0000000000b1'), NULL::integer, 'the other member''s goal was never touched');
SELECT is((SELECT sort_position FROM public.writing_goals WHERE id = '00000000-0000-4000-b000-000000000006'), NULL::integer, 'another project''s goal in the list was ignored');

-- Audit: one entry per reorder that changed something, as who did it, with the order before and after.
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'writing_goal_order' AND entity_id = 'prj_GoalOrdP0001'), 2,
  'two reorders that changed the order wrote two entries; the repeat and the refused ones wrote none');
SELECT is(
  (SELECT jsonb_build_object('kind', actor_kind, 'who', changed_by, 'member', member_id, 'old', changes #> '{order,old}', 'new', changes #> '{order,new}')
     FROM public.audit_log WHERE entity_type = 'writing_goal_order' AND entity_id = 'prj_GoalOrdP0001' AND actor_kind = 'member'),
  jsonb_build_object('kind', 'member', 'who', '00000000-0000-4000-a000-00000000d2a1', 'member', 'mbr_GoalOrdAlic1',
    'old', '["00000000-0000-4000-b000-000000000001","00000000-0000-4000-b000-000000000002","00000000-0000-4000-b000-000000000003"]'::jsonb,
    'new', '["00000000-0000-4000-b000-000000000003","00000000-0000-4000-b000-000000000001","00000000-0000-4000-b000-000000000002"]'::jsonb),
  'the member''s reorder is one entry with the order before (by id, as it was) and after');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'writing_goal_order' AND entity_id = 'prj_GoalOrdP0001' AND actor_kind = 'staff'), 1,
  'the admin''s reorder is recorded as staff');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'writing_goal' AND action = 'update' AND changes ? 'sort_position'
    AND entity_id LIKE '00000000-0000-4000-b000-%'), 0,
  'a change of position alone writes no entry per goal');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'writing_goal' AND entity_id = '00000000-0000-4000-b000-000000000002' AND action = 'update' AND changes ? 'is_starred'), 1,
  'changing a goal is still audited');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'writing_goal' AND entity_id = '00000000-0000-4000-b000-000000000001' AND action = 'insert'), 1,
  'creating a goal is still audited');

SELECT * FROM finish(true);
ROLLBACK;
