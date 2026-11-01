-- pgTAP tests for 20270325000000_soft_delete_writing_projects.sql:
--   * the owner can soft delete a project (the UPDATE ... RETURNING the app runs works) and another
--     member can't;
--   * get_profile_writing and get_member_directory leave a deleted project out.
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched.
-- Run with `pnpm test:pgtap` (scripts/test-pgtap.sh; CI runs it in the test-db job).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(5);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000e1a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'prjdel-alice@example.test'),
  ('00000000-0000-4000-a000-00000000e1a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'prjdel-bob@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000e1a1', 'prjdel-alice@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000e1a2', 'prjdel-bob@example.test', 'member')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('mbr_AAAAAAAAe1A1', 'Prjdel Alice', 'prjdel-alice@example.test', now(), 'active', '00000000-0000-4000-a000-00000000e1a1'),
  ('mbr_AAAAAAAAe1A2', 'Prjdel Bob', 'prjdel-bob@example.test', now(), 'active', '00000000-0000-4000-a000-00000000e1a2');

INSERT INTO public.writing_projects (id, member_id, title, show_on_profile, deleted_at, created_at) VALUES
  ('prj_AAAAAAAAe111', 'mbr_AAAAAAAAe1A1', 'Live project', true, NULL, '2026-01-01'),
  ('prj_AAAAAAAAe113', 'mbr_AAAAAAAAe1A1', 'Deleted project', true, now(), '2026-01-03'),
  ('prj_AAAAAAAAe114', 'mbr_AAAAAAAAe1A1', 'To delete', true, NULL, '2026-01-04');

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;

-- Bob, another member: sees only the live project in the profile and directory, and can't delete Alice's.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000e1a2", "email": "prjdel-bob@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'profile_titles', (
  SELECT COALESCE(jsonb_agg(t ORDER BY t), '[]'::jsonb)
  FROM jsonb_path_query(public.get_profile_writing('mbr_AAAAAAAAe1A1'), '$.projects[*].title') AS t);
INSERT INTO result SELECT 'directory_titles', to_jsonb(projects)
  FROM public.get_member_directory() WHERE id = 'mbr_AAAAAAAAe1A1';
WITH u AS (UPDATE public.writing_projects SET deleted_at = now() WHERE id = 'prj_AAAAAAAAe114' RETURNING id)
INSERT INTO result SELECT 'bob_deletes_alices', to_jsonb(count(*)) FROM u;

-- Alice, the owner: the soft-delete UPDATE ... RETURNING works.
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000e1a1", "email": "prjdel-alice@example.test", "role": "authenticated"}', true);
WITH u AS (UPDATE public.writing_projects SET deleted_at = now() WHERE id = 'prj_AAAAAAAAe114' AND deleted_at IS NULL RETURNING id)
INSERT INTO result SELECT 'alice_deletes', to_jsonb(count(*)) FROM u;
INSERT INTO result SELECT 'alice_after', to_jsonb(count(*)) FROM public.writing_projects WHERE id = 'prj_AAAAAAAAe114' AND deleted_at IS NOT NULL;
RESET ROLE;

SELECT is((SELECT value FROM result WHERE label = 'profile_titles'), '["Live project", "To delete"]'::jsonb, 'a profile shows no deleted project');
SELECT is((SELECT value FROM result WHERE label = 'directory_titles'), '["Live project", "To delete"]'::jsonb, 'the directory shows no deleted project');
SELECT is((SELECT value FROM result WHERE label = 'bob_deletes_alices'), '0'::jsonb, 'another member can''t delete someone else''s project');
SELECT is((SELECT value FROM result WHERE label = 'alice_deletes'), '1'::jsonb, 'the owner can soft delete her project and get the row back');
SELECT is((SELECT value FROM result WHERE label = 'alice_after'), '1'::jsonb, 'the owner still sees the deleted row (the app filters it out)');

SELECT * FROM finish(true);
ROLLBACK;
