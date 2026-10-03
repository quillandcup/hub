-- pgTAP tests for writing_prompt_dismissals (20261003010000): the member or an admin, nobody else,
-- and one row per (member, prickle).
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched.
-- Run with `npm run test:pgtap` (scripts/test-pgtap.sh; CI runs it in the test-db job).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(6);

-- Alice and Bob are regular members, Dana an admin. Fixed ids nothing else uses.
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000e1a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dismiss-alice@example.test'),
  ('00000000-0000-4000-a000-00000000e1a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dismiss-bob@example.test'),
  ('00000000-0000-4000-a000-00000000e1a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dismiss-dana@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000e1a1', 'dismiss-alice@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000e1a2', 'dismiss-bob@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000e1a4', 'dismiss-dana@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('00000000-0000-4000-a000-00000000e101', 'Dismiss Alice', 'dismiss-alice@example.test', now(), 'active'),
  ('00000000-0000-4000-a000-00000000e102', 'Dismiss Bob', 'dismiss-bob@example.test', now(), 'active'),
  ('00000000-0000-4000-a000-00000000e104', 'Dismiss Dana', 'dismiss-dana@example.test', now(), 'active');

INSERT INTO public.prickles (id, start_time, end_time, source) VALUES
  ('00000000-0000-4000-a000-00000000e1f1', '2026-01-05T15:00:00Z', '2026-01-05T16:00:00Z', 'calendar');

INSERT INTO public.writing_prompt_dismissals (member_id, prickle_id) VALUES
  ('00000000-0000-4000-a000-00000000e102', '00000000-0000-4000-a000-00000000e1f1');

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;

SET LOCAL ROLE authenticated;

-- As Alice: dismisses for herself, sees only her own.
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000e1a1", "email": "dismiss-alice@example.test", "role": "authenticated"}', true);
INSERT INTO public.writing_prompt_dismissals (member_id, prickle_id)
VALUES ('00000000-0000-4000-a000-00000000e101', '00000000-0000-4000-a000-00000000e1f1');
INSERT INTO result SELECT 'alice_sees', jsonb_agg(member_id) FROM public.writing_prompt_dismissals
  WHERE prickle_id = '00000000-0000-4000-a000-00000000e1f1';
DELETE FROM public.writing_prompt_dismissals WHERE member_id = '00000000-0000-4000-a000-00000000e102';

-- As Dana (admin): sees everyone's.
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000e1a4", "email": "dismiss-dana@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'admin_sees', to_jsonb(count(*)) FROM public.writing_prompt_dismissals
  WHERE prickle_id = '00000000-0000-4000-a000-00000000e1f1';
RESET ROLE;

SELECT is(
  (SELECT value FROM result WHERE label = 'alice_sees'),
  '["00000000-0000-4000-a000-00000000e101"]'::jsonb,
  'a member sees only their own dismissals'
);
SELECT is((SELECT value FROM result WHERE label = 'admin_sees'), '2'::jsonb, 'admins see every dismissal');
SELECT is(
  (SELECT count(*)::int FROM public.writing_prompt_dismissals WHERE member_id = '00000000-0000-4000-a000-00000000e102'),
  1,
  'a member cannot delete someone else''s dismissal'
);

SELECT throws_ok(
  $$SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000e1a1", "email": "dismiss-alice@example.test", "role": "authenticated"}', true);
    INSERT INTO public.writing_prompt_dismissals (member_id, prickle_id)
    VALUES ('00000000-0000-4000-a000-00000000e104', '00000000-0000-4000-a000-00000000e1f1')$$,
  '42501',
  NULL,
  'a member cannot dismiss for someone else'
);
RESET ROLE;

SELECT throws_ok(
  $$INSERT INTO public.writing_prompt_dismissals (member_id, prickle_id)
    VALUES ('00000000-0000-4000-a000-00000000e101', '00000000-0000-4000-a000-00000000e1f1')$$,
  '23505',
  NULL,
  'one dismissal per member and prickle'
);

DELETE FROM public.prickles WHERE id = '00000000-0000-4000-a000-00000000e1f1';
SELECT is(
  (SELECT count(*)::int FROM public.writing_prompt_dismissals WHERE prickle_id = '00000000-0000-4000-a000-00000000e1f1'),
  0,
  'deleting a prickle deletes its dismissals'
);

SELECT * FROM finish(true);
ROLLBACK;
