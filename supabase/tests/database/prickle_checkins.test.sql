-- pgTAP tests for prickle_checkins (20261003000000, 20261003140000): the member and admins read,
-- only the member writes, nobody but a cascade hard-deletes, and the CHECKs on the option keys.
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched.
-- Run with `npm run test:pgtap` (scripts/test-pgtap.sh; CI runs it in the test-db job).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(14);

-- Alice and Bob are regular members, Dana an admin. Fixed ids nothing else uses.
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000d1a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'checkin-alice@example.test'),
  ('00000000-0000-4000-a000-00000000d1a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'checkin-bob@example.test'),
  ('00000000-0000-4000-a000-00000000d1a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'checkin-dana@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000d1a1', 'checkin-alice@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000d1a2', 'checkin-bob@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000d1a4', 'checkin-dana@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('00000000-0000-4000-a000-00000000d101', 'Checkin Alice', 'checkin-alice@example.test', now(), 'active'),
  ('00000000-0000-4000-a000-00000000d102', 'Checkin Bob', 'checkin-bob@example.test', now(), 'active'),
  ('00000000-0000-4000-a000-00000000d104', 'Checkin Dana', 'checkin-dana@example.test', now(), 'active');

INSERT INTO public.prickles (id, start_time, end_time, source) VALUES
  ('00000000-0000-4000-a000-00000000d1f1', '2026-01-05T15:00:00Z', '2026-01-05T16:00:00Z', 'calendar');

-- Bob's existing check-in: Alice must not see or change it; Dana (admin) can see but not change it.
INSERT INTO public.prickle_checkins (member_id, prickle_id, feelings_before, need) VALUES
  ('00000000-0000-4000-a000-00000000d102', '00000000-0000-4000-a000-00000000d1f1', ARRAY['lonely'], 'company');

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;

SET LOCAL ROLE authenticated;

-- As Alice: writes her own check-in, sees only hers, can't touch Bob's.
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000d1a1", "email": "checkin-alice@example.test", "role": "authenticated"}', true);
INSERT INTO public.prickle_checkins (member_id, prickle_id, feelings_before, need, session_rating, feelings_after)
VALUES ('00000000-0000-4000-a000-00000000d101', '00000000-0000-4000-a000-00000000d1f1',
        ARRAY['stressed', 'tired'], 'company', 4, ARRAY['calm']);
INSERT INTO result SELECT 'alice_sees', jsonb_agg(member_id) FROM public.prickle_checkins
  WHERE prickle_id = '00000000-0000-4000-a000-00000000d1f1';
UPDATE public.prickle_checkins SET need = 'momentum'
  WHERE member_id = '00000000-0000-4000-a000-00000000d102';
UPDATE public.prickle_checkins SET deleted_at = now()
  WHERE member_id = '00000000-0000-4000-a000-00000000d102';
-- Clearing her own check-in soft-deletes it.
UPDATE public.prickle_checkins SET deleted_at = now()
  WHERE member_id = '00000000-0000-4000-a000-00000000d101';
INSERT INTO result SELECT 'alice_soft_deleted', to_jsonb(deleted_at IS NOT NULL) FROM public.prickle_checkins
  WHERE member_id = '00000000-0000-4000-a000-00000000d101';

-- As Dana (admin): reads everyone's check-ins, can't change them.
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000d1a4", "email": "checkin-dana@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'admin_sees', to_jsonb(count(*)) FROM public.prickle_checkins
  WHERE prickle_id = '00000000-0000-4000-a000-00000000d1f1';
UPDATE public.prickle_checkins SET need = 'momentum', deleted_at = now()
  WHERE member_id = '00000000-0000-4000-a000-00000000d102';
RESET ROLE;

SELECT is(
  (SELECT value FROM result WHERE label = 'alice_sees'),
  '["00000000-0000-4000-a000-00000000d101"]'::jsonb,
  'a member sees only their own check-ins'
);
SELECT is(
  (SELECT value FROM result WHERE label = 'admin_sees'),
  '2'::jsonb,
  'admins can read every member''s check-ins'
);
SELECT is(
  (SELECT need FROM public.prickle_checkins WHERE member_id = '00000000-0000-4000-a000-00000000d102'),
  'company',
  'neither another member nor an admin can update someone else''s check-in'
);
SELECT is(
  (SELECT deleted_at FROM public.prickle_checkins WHERE member_id = '00000000-0000-4000-a000-00000000d102'),
  NULL,
  'neither another member nor an admin can soft-delete someone else''s check-in'
);
SELECT is(
  (SELECT value FROM result WHERE label = 'alice_soft_deleted'),
  'true'::jsonb,
  'a member can soft-delete their own check-in'
);
SELECT throws_ok(
  $$SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000d1a1", "email": "checkin-alice@example.test", "role": "authenticated"}', true);
    DELETE FROM public.prickle_checkins WHERE member_id = '00000000-0000-4000-a000-00000000d101'$$,
  '42501',
  NULL,
  'a member cannot hard-delete a check-in, even their own'
);
RESET ROLE;

SELECT throws_ok(
  $$SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000d1a1", "email": "checkin-alice@example.test", "role": "authenticated"}', true);
    INSERT INTO public.prickle_checkins (member_id, prickle_id, need)
    VALUES ('00000000-0000-4000-a000-00000000d104', '00000000-0000-4000-a000-00000000d1f1', 'company')$$,
  '42501',
  NULL,
  'a member cannot write a check-in for someone else'
);
RESET ROLE;

SELECT throws_ok(
  $$SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000d1a4", "email": "checkin-dana@example.test", "role": "authenticated"}', true);
    INSERT INTO public.prickle_checkins (member_id, prickle_id, need)
    VALUES ('00000000-0000-4000-a000-00000000d102', '00000000-0000-4000-a000-00000000d1f1', 'company')$$,
  '42501',
  NULL,
  'an admin cannot write a check-in for a member'
);
RESET ROLE;

SELECT throws_ok(
  $$INSERT INTO public.prickle_checkins (member_id, prickle_id, feelings_before)
    VALUES ('00000000-0000-4000-a000-00000000d104', '00000000-0000-4000-a000-00000000d1f1', ARRAY['hangry'])$$,
  '23514',
  NULL,
  'unknown feelings are rejected'
);
SELECT throws_ok(
  $$INSERT INTO public.prickle_checkins (member_id, prickle_id, feelings_after)
    VALUES ('00000000-0000-4000-a000-00000000d104', '00000000-0000-4000-a000-00000000d1f1', ARRAY['calm', 'content', 'curious'])$$,
  '23514',
  NULL,
  'more than two feelings are rejected'
);
SELECT throws_ok(
  $$INSERT INTO public.prickle_checkins (member_id, prickle_id, need)
    VALUES ('00000000-0000-4000-a000-00000000d104', '00000000-0000-4000-a000-00000000d1f1', 'snacks')$$,
  '23514',
  NULL,
  'unknown needs are rejected'
);
SELECT throws_ok(
  $$INSERT INTO public.prickle_checkins (member_id, prickle_id, session_rating)
    VALUES ('00000000-0000-4000-a000-00000000d104', '00000000-0000-4000-a000-00000000d1f1', 6)$$,
  '23514',
  NULL,
  'ratings outside 1-5 are rejected'
);
SELECT throws_ok(
  $$INSERT INTO public.prickle_checkins (member_id, prickle_id)
    VALUES ('00000000-0000-4000-a000-00000000d104', '00000000-0000-4000-a000-00000000d1f1')$$,
  '23514',
  NULL,
  'an empty check-in is rejected (clearing soft-deletes the row instead)'
);

DELETE FROM public.prickles WHERE id = '00000000-0000-4000-a000-00000000d1f1';
SELECT is(
  (SELECT count(*)::int FROM public.prickle_checkins WHERE prickle_id = '00000000-0000-4000-a000-00000000d1f1'),
  0,
  'deleting a prickle deletes its check-ins'
);

SELECT * FROM finish(true);
ROLLBACK;
