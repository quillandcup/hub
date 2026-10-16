-- pgTAP tests for member_reminder_log (created in 20261105000000, renamed in 20261106000000): service role only, one reminder per
-- member, kind and day, and gone with the member.
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched.
-- Run with `npm run test:pgtap` (scripts/test-pgtap.sh; CI runs it in the test-db job).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(7);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000f1a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'nudgelog-alice@example.test'),
  ('00000000-0000-4000-a000-00000000f1a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'nudgelog-dana@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000f1a1', 'nudgelog-alice@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000f1a4', 'nudgelog-dana@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('00000000-0000-4000-a000-00000000f101', 'Nudgelog Alice', 'nudgelog-alice@example.test', now(), 'active'),
  ('00000000-0000-4000-a000-00000000f104', 'Nudgelog Dana', 'nudgelog-dana@example.test', now(), 'active');

INSERT INTO public.member_reminder_log (member_id, kind) VALUES
  ('00000000-0000-4000-a000-00000000f101', 'intro_nudge');

-- Same member and kind on the same day is the dedup the job relies on; another kind is fine.
SELECT throws_ok(
  $$INSERT INTO public.member_reminder_log (member_id, kind) VALUES ('00000000-0000-4000-a000-00000000f101', 'intro_nudge')$$,
  '23505', NULL, 'a second reminder of a kind on the same day is refused'
);
SELECT lives_ok(
  $$INSERT INTO public.member_reminder_log (member_id, kind) VALUES ('00000000-0000-4000-a000-00000000f101', 'prickle_nudge')$$,
  'a different kind the same day is allowed'
);
SELECT lives_ok(
  $$INSERT INTO public.member_reminder_log (member_id, kind, sent_on) VALUES ('00000000-0000-4000-a000-00000000f101', 'intro_nudge', current_date + 7)$$,
  'the same kind on another day is allowed'
);
SELECT throws_ok(
  $$INSERT INTO public.member_reminder_log (member_id, kind) VALUES ('00000000-0000-4000-a000-00000000f104', 'something_else')$$,
  '23514', NULL, 'unknown kinds are refused'
);

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;

SET LOCAL ROLE authenticated;

-- Neither a member nor an admin can read or write it: the job runs as the service role.
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000f1a1", "email": "nudgelog-alice@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'member_sees', to_jsonb(count(*)) FROM public.member_reminder_log;

SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000f1a4", "email": "nudgelog-dana@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'admin_sees', to_jsonb(count(*)) FROM public.member_reminder_log;
RESET ROLE;

SELECT is((SELECT value FROM result WHERE label = 'member_sees'), '0'::jsonb, 'a member sees no reminder log rows');
SELECT is((SELECT value FROM result WHERE label = 'admin_sees'), '0'::jsonb, 'an admin sees no reminder log rows');

DELETE FROM public.members WHERE id = '00000000-0000-4000-a000-00000000f101';
SELECT is(
  (SELECT count(*)::int FROM public.member_reminder_log WHERE member_id = '00000000-0000-4000-a000-00000000f101'),
  0,
  'deleting a member removes their log rows'
);

SELECT * FROM finish(true);
ROLLBACK;
