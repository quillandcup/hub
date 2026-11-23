-- pgTAP tests for reorder_writing_projects (20270808000000): a member puts their own projects in an order of
-- their choosing in one statement; ids that aren't theirs (or are deleted) are ignored; nobody can reorder
-- another member's list except an admin (sudo acts through the admin's own session); and a reorder is one entry
-- in the audit log, not one per project. Runs in one transaction that is rolled back, so it leaves the shared
-- local DB untouched. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(12);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000d1a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'reorder-alice@example.test'),
  ('00000000-0000-4000-a000-00000000d1a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'reorder-bob@example.test'),
  ('00000000-0000-4000-a000-00000000d1a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'reorder-dana@example.test');
INSERT INTO public.user_profiles (id, email) VALUES
  ('00000000-0000-4000-a000-00000000d1a1', 'reorder-alice@example.test'),
  ('00000000-0000-4000-a000-00000000d1a2', 'reorder-bob@example.test'),
  ('00000000-0000-4000-a000-00000000d1a4', 'reorder-dana@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-4000-a000-00000000d1a4', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;
INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('mbr_ReorderAlic1', 'Reorder Alice', 'reorder-alice@example.test', now(), 'active', '00000000-0000-4000-a000-00000000d1a1'),
  ('mbr_ReorderBob01', 'Reorder Bob', 'reorder-bob@example.test', now(), 'active', '00000000-0000-4000-a000-00000000d1a2');

-- Alice has three going projects (made in the order p1, p2, p3), one hibernating and one deleted; Bob has one.
INSERT INTO public.writing_projects (id, member_id, title, phase, created_at, deleted_at) VALUES
  ('prj_ReorderP0001', 'mbr_ReorderAlic1', 'Project 1', 'drafting', '2026-01-01T10:00:00Z', NULL),
  ('prj_ReorderP0002', 'mbr_ReorderAlic1', 'Project 2', 'drafting', '2026-02-01T10:00:00Z', NULL),
  ('prj_ReorderP0003', 'mbr_ReorderAlic1', 'Project 3', 'drafting', '2026-03-01T10:00:00Z', NULL),
  ('prj_ReorderP0004', 'mbr_ReorderAlic1', 'Shelved', 'hibernating', '2026-04-01T10:00:00Z', NULL),
  ('prj_ReorderP0005', 'mbr_ReorderAlic1', 'Deleted', 'drafting', '2026-05-01T10:00:00Z', now()),
  ('prj_ReorderB0001', 'mbr_ReorderBob01', 'Bob 1', 'drafting', '2026-01-01T10:00:00Z', NULL);

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

-- Alice reorders her own list, with a stranger's project, a deleted one and a repeat thrown in.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000d1a1", "email": "reorder-alice@example.test", "role": "authenticated"}', true);
SELECT public.reorder_writing_projects('mbr_ReorderAlic1',
  ARRAY['prj_ReorderP0001', 'prj_ReorderB0001', 'prj_ReorderP0003', 'prj_ReorderP0005', 'prj_ReorderP0001', 'prj_ReorderP0002', 'nope']);
INSERT INTO result SELECT 'positions', to_jsonb(array_agg(id || '=' || coalesce(sort_position::text, 'null') ORDER BY id))
  FROM public.writing_projects WHERE member_id = 'mbr_ReorderAlic1';
INSERT INTO result SELECT 'bob_position', to_jsonb(sort_position) FROM public.writing_projects WHERE id = 'prj_ReorderB0001';

-- The same list again changes nothing.
SELECT public.reorder_writing_projects('mbr_ReorderAlic1', ARRAY['prj_ReorderP0001', 'prj_ReorderP0003', 'prj_ReorderP0002']);
INSERT INTO result SELECT 'positions_again', to_jsonb(array_agg(id || '=' || coalesce(sort_position::text, 'null') ORDER BY id))
  FROM public.writing_projects WHERE member_id = 'mbr_ReorderAlic1';

-- She can't reorder Bob's list, and renaming a project is still audited.
INSERT INTO result SELECT 'other_member_message', to_jsonb(pg_temp.failure($$SELECT public.reorder_writing_projects('mbr_ReorderBob01', ARRAY['prj_ReorderB0001'])$$));
UPDATE public.writing_projects SET title = 'Project 2, renamed' WHERE id = 'prj_ReorderP0002';

-- A signed-out caller (no claims) is refused too.
SELECT set_config('request.jwt.claims', '', true);
INSERT INTO result SELECT 'signed_out_message', to_jsonb(pg_temp.failure($$SELECT public.reorder_writing_projects('mbr_ReorderAlic1', ARRAY['prj_ReorderP0001'])$$));

-- Dana, an admin (sudo works through her own session), reorders Alice's list.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000d1a4", "email": "reorder-dana@example.test", "role": "authenticated"}', true);
SELECT public.reorder_writing_projects('mbr_ReorderAlic1', ARRAY['prj_ReorderP0002', 'prj_ReorderP0001', 'prj_ReorderP0003']);
RESET ROLE;

SELECT is((SELECT value FROM result WHERE label = 'positions'),
  '["prj_ReorderP0001=1","prj_ReorderP0002=3","prj_ReorderP0003=2","prj_ReorderP0004=null","prj_ReorderP0005=null"]'::jsonb,
  'the member''s live projects get 1..n in the given order (a repeat counts once); the shelved and the deleted one are left alone');
SELECT is((SELECT value FROM result WHERE label = 'positions_again'), (SELECT value FROM result WHERE label = 'positions'), 'the same list again changes nothing');
SELECT is((SELECT value FROM result WHERE label = 'other_member_message'), '"not_allowed"'::jsonb, 'a member can''t reorder another member''s list');
SELECT is((SELECT value FROM result WHERE label = 'signed_out_message'), '"not_allowed"'::jsonb, 'someone who isn''t signed in can''t reorder');
SELECT is((SELECT jsonb_agg(id ORDER BY sort_position) FROM public.writing_projects WHERE member_id = 'mbr_ReorderAlic1' AND sort_position IS NOT NULL),
  '["prj_ReorderP0002","prj_ReorderP0001","prj_ReorderP0003"]'::jsonb, 'an admin can reorder a member''s list');
SELECT is((SELECT sort_position FROM public.writing_projects WHERE id = 'prj_ReorderB0001'), NULL::integer, 'the other member''s project was never touched');

-- Audit: one entry per reorder that changed something, as who did it, with the order before and after.
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'writing_project_order' AND entity_id = 'mbr_ReorderAlic1'), 2,
  'two reorders that changed the order wrote two entries; the repeat and the refused ones wrote none');
SELECT is(
  (SELECT jsonb_build_object('kind', actor_kind, 'who', changed_by, 'member', member_id, 'old', changes #> '{order,old}', 'new', changes #> '{order,new}')
     FROM public.audit_log WHERE entity_type = 'writing_project_order' AND entity_id = 'mbr_ReorderAlic1' AND actor_kind = 'member'),
  jsonb_build_object('kind', 'member', 'who', '00000000-0000-4000-a000-00000000d1a1', 'member', 'mbr_ReorderAlic1',
    'old', '["prj_ReorderP0003","prj_ReorderP0002","prj_ReorderP0001"]'::jsonb,
    'new', '["prj_ReorderP0001","prj_ReorderP0003","prj_ReorderP0002"]'::jsonb),
  'the member''s reorder is one entry with the order before (newest first, as it was) and after');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'writing_project_order' AND entity_id = 'mbr_ReorderAlic1' AND actor_kind = 'staff'), 1,
  'the admin''s reorder is recorded as staff');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'writing_project' AND action = 'update' AND changes ? 'sort_position'
    AND entity_id IN ('prj_ReorderP0001','prj_ReorderP0002','prj_ReorderP0003','prj_ReorderP0004','prj_ReorderP0005','prj_ReorderB0001')), 0,
  'a change of position alone writes no entry per project');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'writing_project' AND entity_id = 'prj_ReorderP0002' AND action = 'update' AND changes ? 'title'), 1,
  'renaming a project is still audited');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'writing_project' AND entity_id = 'prj_ReorderP0001' AND action = 'insert'), 1,
  'creating a project is still audited');

SELECT * FROM finish(true);
ROLLBACK;
