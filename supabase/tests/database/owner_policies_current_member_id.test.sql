-- pgTAP tests for 20261001000000_owner_policies_use_current_member_id.sql:
--   * a member linked by members.user_id whose login email differs from their member email
--     can write their own writing_projects / writing_goals / member_books rows (the bug: these
--     policies matched by email only and rejected the insert).
--   * a member matched only by email (no user_id link) still can.
--   * nobody can write another member's rows; admins can write anyone's (sudo).
--   * current_member_id() prefers the user_id link over an email match on a different row.
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched.
-- Run with `npm run test:pgtap` (scripts/test-pgtap.sh; CI runs it in the test-db job).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(10);

-- Alice: linked by user_id, login email differs from her member email. Bob: email match only.
-- Dana: admin. Fixed ids nothing else uses.
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000f1a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-alice-login@example.test'),
  ('00000000-0000-4000-a000-00000000f1a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-bob@example.test'),
  ('00000000-0000-4000-a000-00000000f1a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-dana@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000f1a1', 'owner-alice-login@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000f1a2', 'owner-bob@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000f1a4', 'owner-dana@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('00000000-0000-4000-a000-00000000f101', 'Owner Alice', 'owner-alice@example.test', now(), 'active',
   '00000000-0000-4000-a000-00000000f1a1'),
  ('00000000-0000-4000-a000-00000000f102', 'Owner Bob', 'owner-bob@example.test', now(), 'active', NULL),
  ('00000000-0000-4000-a000-00000000f104', 'Owner Dana', 'owner-dana@example.test', now(), 'active',
   '00000000-0000-4000-a000-00000000f1a4');

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;

-- Alice (user_id link, mismatched email).
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000f1a1", "email": "owner-alice-login@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'alice_member_id', to_jsonb(public.current_member_id());
INSERT INTO public.writing_projects (id, member_id, title, phase)
VALUES ('00000000-0000-4000-a000-00000000f201', '00000000-0000-4000-a000-00000000f101', 'Paint Magic Fantasy', 'planning');
INSERT INTO public.writing_goals (member_id, project_id, goal_type, measure, target_amount)
VALUES ('00000000-0000-4000-a000-00000000f101', '00000000-0000-4000-a000-00000000f201', 'target', 'words', 50000);
INSERT INTO result SELECT 'alice_sees', to_jsonb(count(*)) FROM public.writing_projects
  WHERE title = 'Paint Magic Fantasy';

-- Bob (email match only).
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000f1a2", "email": "owner-bob@example.test", "role": "authenticated"}', true);
INSERT INTO public.writing_projects (id, member_id, title)
VALUES ('00000000-0000-4000-a000-00000000f202', '00000000-0000-4000-a000-00000000f102', 'Bob''s Book');
INSERT INTO result SELECT 'bob_sees', to_jsonb(count(*)) FROM public.writing_projects
  WHERE id IN ('00000000-0000-4000-a000-00000000f201', '00000000-0000-4000-a000-00000000f202');
UPDATE public.writing_projects SET title = 'Hijacked' WHERE id = '00000000-0000-4000-a000-00000000f201';

-- Dana (admin) writes for Alice, as a sudo'd write would.
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000f1a4", "email": "owner-dana@example.test", "role": "authenticated"}', true);
INSERT INTO public.writing_projects (id, member_id, title)
VALUES ('00000000-0000-4000-a000-00000000f203', '00000000-0000-4000-a000-00000000f101', 'By Admin');
RESET ROLE;

-- 1-4
SELECT is(
  (SELECT value FROM result WHERE label = 'alice_member_id'),
  '"00000000-0000-4000-a000-00000000f101"'::jsonb,
  'current_member_id() resolves a member by user_id when the login email differs'
);
SELECT is(
  (SELECT member_id FROM public.writing_projects WHERE id = '00000000-0000-4000-a000-00000000f201'),
  '00000000-0000-4000-a000-00000000f101'::uuid,
  'a member whose login email differs from their member email can create a project'
);
SELECT is(
  (SELECT count(*)::int FROM public.writing_goals WHERE project_id = '00000000-0000-4000-a000-00000000f201'),
  1,
  '...and a goal on it'
);
SELECT is((SELECT value FROM result WHERE label = 'alice_sees'), '1'::jsonb, '...and read it back');

-- 5-7
SELECT is(
  (SELECT member_id FROM public.writing_projects WHERE id = '00000000-0000-4000-a000-00000000f202'),
  '00000000-0000-4000-a000-00000000f102'::uuid,
  'a member matched only by email (no user_id link) can still create a project'
);
SELECT is((SELECT value FROM result WHERE label = 'bob_sees'), '1'::jsonb, 'a member sees only their own projects');
SELECT is(
  (SELECT title FROM public.writing_projects WHERE id = '00000000-0000-4000-a000-00000000f201'),
  'Paint Magic Fantasy',
  'a member cannot update another member''s project'
);

-- 8
SELECT is(
  (SELECT member_id FROM public.writing_projects WHERE id = '00000000-0000-4000-a000-00000000f203'),
  '00000000-0000-4000-a000-00000000f101'::uuid,
  'an admin can create a project for any member'
);

-- 9
SELECT throws_ok(
  $$SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f1a1", "email": "owner-alice-login@example.test", "role": "authenticated"}', true);
    INSERT INTO public.writing_projects (member_id, title)
    VALUES ('00000000-0000-4000-a000-00000000f102', 'Forged for Bob')$$,
  '42501',
  NULL,
  'a member cannot create a project for another member'
);
RESET ROLE;

-- 10: a second member row carrying Alice's login email (a split contact) doesn't win over the
-- user_id link.
INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('00000000-0000-4000-a000-00000000f105', 'Owner Alice Duplicate', 'owner-alice-login@example.test', now(), 'lead');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000f1a1", "email": "owner-alice-login@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'alice_member_id_with_dup', to_jsonb(public.current_member_id());
RESET ROLE;
SELECT is(
  (SELECT value FROM result WHERE label = 'alice_member_id_with_dup'),
  '"00000000-0000-4000-a000-00000000f101"'::jsonb,
  'current_member_id() prefers the user_id link over another row matching by email'
);

SELECT * FROM finish(true);
ROLLBACK;
