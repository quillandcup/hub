-- pgTAP tests for member_roster_opt_outs (20261105000100): the member or an admin, nobody else.
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched.
-- Run with `pnpm test:pgtap` (scripts/test-pgtap.sh; CI runs it in the test-db job).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(7);

-- Alice and Bob are regular members, Dana an admin. Fixed ids nothing else uses.
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000f2a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'roster-alice@example.test'),
  ('00000000-0000-4000-a000-00000000f2a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'roster-bob@example.test'),
  ('00000000-0000-4000-a000-00000000f2a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'roster-dana@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000f2a1', 'roster-alice@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000f2a2', 'roster-bob@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000f2a4', 'roster-dana@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('00000000-0000-4000-a000-00000000f201', 'Roster Alice', 'roster-alice@example.test', now(), 'active', '00000000-0000-4000-a000-00000000f2a1'),
  ('00000000-0000-4000-a000-00000000f202', 'Roster Bob', 'roster-bob@example.test', now(), 'active', '00000000-0000-4000-a000-00000000f2a2'),
  ('00000000-0000-4000-a000-00000000f204', 'Roster Dana', 'roster-dana@example.test', now(), 'active', '00000000-0000-4000-a000-00000000f2a4');

-- Bob opted out before the test starts.
INSERT INTO public.member_roster_opt_outs (member_id) VALUES ('00000000-0000-4000-a000-00000000f202');

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;

SET LOCAL ROLE authenticated;

-- As Alice: opts herself out, sees only her own row, can't opt Bob in or out, can't undo his.
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000f2a1", "email": "roster-alice@example.test", "role": "authenticated"}', true);
INSERT INTO public.member_roster_opt_outs (member_id) VALUES ('00000000-0000-4000-a000-00000000f201');
INSERT INTO result SELECT 'alice_sees', jsonb_agg(member_id) FROM public.member_roster_opt_outs
  WHERE member_id IN ('00000000-0000-4000-a000-00000000f201', '00000000-0000-4000-a000-00000000f202');
DELETE FROM public.member_roster_opt_outs WHERE member_id = '00000000-0000-4000-a000-00000000f202';

-- As Dana (admin): sees everyone's.
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000f2a4", "email": "roster-dana@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'admin_sees', to_jsonb(count(*)) FROM public.member_roster_opt_outs
  WHERE member_id IN ('00000000-0000-4000-a000-00000000f201', '00000000-0000-4000-a000-00000000f202');
RESET ROLE;

SELECT is(
  (SELECT value FROM result WHERE label = 'alice_sees'),
  '["00000000-0000-4000-a000-00000000f201"]'::jsonb,
  'a member sees only their own opt-out'
);
SELECT is((SELECT value FROM result WHERE label = 'admin_sees'), '2'::jsonb, 'admins see every opt-out');
SELECT ok(
  EXISTS (SELECT 1 FROM public.member_roster_opt_outs WHERE member_id = '00000000-0000-4000-a000-00000000f201'),
  'a member can opt themselves out'
);
SELECT ok(
  EXISTS (SELECT 1 FROM public.member_roster_opt_outs WHERE member_id = '00000000-0000-4000-a000-00000000f202'),
  'a member cannot remove someone else''s opt-out'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000f2a1", "email": "roster-alice@example.test", "role": "authenticated"}', true);
SELECT throws_ok(
  $$INSERT INTO public.member_roster_opt_outs (member_id) VALUES ('00000000-0000-4000-a000-00000000f204')$$,
  '42501', NULL, 'a member cannot opt someone else out'
);
DELETE FROM public.member_roster_opt_outs WHERE member_id = '00000000-0000-4000-a000-00000000f201';
RESET ROLE;
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.member_roster_opt_outs WHERE member_id = '00000000-0000-4000-a000-00000000f201'),
  'a member can opt back in'
);

DELETE FROM public.members WHERE id = '00000000-0000-4000-a000-00000000f202';
SELECT is(
  (SELECT count(*)::int FROM public.member_roster_opt_outs WHERE member_id = '00000000-0000-4000-a000-00000000f202'),
  0,
  'deleting a member removes their opt-out'
);

SELECT * FROM finish(true);
ROLLBACK;
