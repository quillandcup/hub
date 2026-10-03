-- pgTAP tests for member_onboarding (20261003170000): the member or an admin, nobody else.
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched.
-- Run with `npm run test:pgtap` (scripts/test-pgtap.sh; CI runs it in the test-db job).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(5);

-- Alice and Bob are regular members, Dana an admin. Fixed ids nothing else uses.
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000f0a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'onboard-alice@example.test'),
  ('00000000-0000-4000-a000-00000000f0a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'onboard-bob@example.test'),
  ('00000000-0000-4000-a000-00000000f0a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'onboard-dana@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000f0a1', 'onboard-alice@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000f0a2', 'onboard-bob@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000f0a4', 'onboard-dana@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('00000000-0000-4000-a000-00000000f001', 'Onboard Alice', 'onboard-alice@example.test', now(), 'active'),
  ('00000000-0000-4000-a000-00000000f002', 'Onboard Bob', 'onboard-bob@example.test', now(), 'active'),
  ('00000000-0000-4000-a000-00000000f004', 'Onboard Dana', 'onboard-dana@example.test', now(), 'active');

INSERT INTO public.member_onboarding (member_id, marked_steps) VALUES
  ('00000000-0000-4000-a000-00000000f002', '{identity}');

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;

SET LOCAL ROLE authenticated;

-- As Alice: starts her own tour, sees only her own row, can't change Bob's.
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000f0a1", "email": "onboard-alice@example.test", "role": "authenticated"}', true);
INSERT INTO public.member_onboarding (member_id, marked_steps)
VALUES ('00000000-0000-4000-a000-00000000f001', '{profile}');
INSERT INTO result SELECT 'alice_sees', jsonb_agg(member_id) FROM public.member_onboarding
  WHERE member_id IN ('00000000-0000-4000-a000-00000000f001', '00000000-0000-4000-a000-00000000f002');
UPDATE public.member_onboarding SET dismissed_at = now() WHERE member_id = '00000000-0000-4000-a000-00000000f002';

-- As Dana (admin): sees everyone's.
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000f0a4", "email": "onboard-dana@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'admin_sees', to_jsonb(count(*)) FROM public.member_onboarding
  WHERE member_id IN ('00000000-0000-4000-a000-00000000f001', '00000000-0000-4000-a000-00000000f002');
RESET ROLE;

SELECT is(
  (SELECT value FROM result WHERE label = 'alice_sees'),
  '["00000000-0000-4000-a000-00000000f001"]'::jsonb,
  'a member sees only their own tour'
);
SELECT is((SELECT value FROM result WHERE label = 'admin_sees'), '2'::jsonb, 'admins see every tour');
SELECT is(
  (SELECT dismissed_at FROM public.member_onboarding WHERE member_id = '00000000-0000-4000-a000-00000000f002'),
  NULL,
  'a member cannot change someone else''s tour'
);

SELECT throws_ok(
  $$SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f0a1", "email": "onboard-alice@example.test", "role": "authenticated"}', true);
    INSERT INTO public.member_onboarding (member_id) VALUES ('00000000-0000-4000-a000-00000000f004')$$,
  '42501',
  NULL,
  'a member cannot start a tour for someone else'
);
RESET ROLE;

DELETE FROM public.members WHERE id = '00000000-0000-4000-a000-00000000f002';
SELECT is(
  (SELECT count(*)::int FROM public.member_onboarding WHERE member_id = '00000000-0000-4000-a000-00000000f002'),
  0,
  'deleting a member deletes their tour'
);

SELECT * FROM finish(true);
ROLLBACK;
