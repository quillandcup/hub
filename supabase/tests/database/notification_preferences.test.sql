-- pgTAP tests for notification_preferences (20261003160000): the member and admins read, only the
-- member writes, and a member's rows go with them. Runs in one transaction that is rolled back, so
-- it leaves the shared local DB untouched. Run with `npm run test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(7);

-- Alice and Bob are regular members, Dana an admin. Fixed ids nothing else uses.
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000e1a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'notif-alice@example.test'),
  ('00000000-0000-4000-a000-00000000e1a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'notif-bob@example.test'),
  ('00000000-0000-4000-a000-00000000e1a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'notif-dana@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000e1a1', 'notif-alice@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000e1a2', 'notif-bob@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000e1a4', 'notif-dana@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('00000000-0000-4000-a000-00000000e101', 'Notif Alice', 'notif-alice@example.test', now(), 'active'),
  ('00000000-0000-4000-a000-00000000e102', 'Notif Bob', 'notif-bob@example.test', now(), 'active'),
  ('00000000-0000-4000-a000-00000000e104', 'Notif Dana', 'notif-dana@example.test', now(), 'active');

-- Bob turned check-ins off: Alice must not see or change it; Dana (admin) can see but not change it.
INSERT INTO public.notification_preferences (member_id, kind, channel, enabled) VALUES
  ('00000000-0000-4000-a000-00000000e102', 'prickle_checkin', 'slack', false);

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;

SET LOCAL ROLE authenticated;

-- As Alice: saves her own choice (insert, then update via upsert), sees only hers, can't touch Bob's.
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000e1a1", "email": "notif-alice@example.test", "role": "authenticated"}', true);
INSERT INTO public.notification_preferences (member_id, kind, channel, enabled)
VALUES ('00000000-0000-4000-a000-00000000e101', 'prickle_checkout', 'slack', false);
INSERT INTO public.notification_preferences (member_id, kind, channel, enabled)
VALUES ('00000000-0000-4000-a000-00000000e101', 'prickle_checkout', 'slack', true)
ON CONFLICT (member_id, kind, channel) DO UPDATE SET enabled = EXCLUDED.enabled;
INSERT INTO result SELECT 'alice_sees', jsonb_agg(member_id) FROM public.notification_preferences;
UPDATE public.notification_preferences SET enabled = true
  WHERE member_id = '00000000-0000-4000-a000-00000000e102';
DELETE FROM public.notification_preferences WHERE member_id = '00000000-0000-4000-a000-00000000e102';

-- As Dana (admin): reads everyone's, can't change them.
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000e1a4", "email": "notif-dana@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'admin_sees', to_jsonb(count(*)) FROM public.notification_preferences
  WHERE member_id IN ('00000000-0000-4000-a000-00000000e101', '00000000-0000-4000-a000-00000000e102');
UPDATE public.notification_preferences SET enabled = true
  WHERE member_id = '00000000-0000-4000-a000-00000000e102';
RESET ROLE;

SELECT is(
  (SELECT value FROM result WHERE label = 'alice_sees'),
  '["00000000-0000-4000-a000-00000000e101"]'::jsonb,
  'a member sees only their own notification preferences'
);
SELECT is(
  (SELECT enabled FROM public.notification_preferences WHERE member_id = '00000000-0000-4000-a000-00000000e101'),
  true,
  'a member can change their own preference with an upsert'
);
SELECT is(
  (SELECT value FROM result WHERE label = 'admin_sees'),
  '2'::jsonb,
  'admins can read every member''s notification preferences'
);
SELECT is(
  (SELECT enabled FROM public.notification_preferences WHERE member_id = '00000000-0000-4000-a000-00000000e102'),
  false,
  'neither another member nor an admin can change or delete someone else''s preference'
);

SELECT throws_ok(
  $$SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000e1a1", "email": "notif-alice@example.test", "role": "authenticated"}', true);
    INSERT INTO public.notification_preferences (member_id, kind, channel, enabled)
    VALUES ('00000000-0000-4000-a000-00000000e102', 'prickle_checkout', 'slack', true)$$,
  '42501',
  NULL,
  'a member cannot write a preference for someone else'
);
RESET ROLE;

SELECT throws_ok(
  $$SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000e1a4", "email": "notif-dana@example.test", "role": "authenticated"}', true);
    INSERT INTO public.notification_preferences (member_id, kind, channel, enabled)
    VALUES ('00000000-0000-4000-a000-00000000e102', 'prickle_checkout', 'slack', true)$$,
  '42501',
  NULL,
  'an admin cannot write a preference for a member'
);
RESET ROLE;

DELETE FROM public.members WHERE id = '00000000-0000-4000-a000-00000000e102';
SELECT is(
  (SELECT count(*)::int FROM public.notification_preferences WHERE member_id = '00000000-0000-4000-a000-00000000e102'),
  0,
  'deleting a member deletes their notification preferences'
);

SELECT * FROM finish(true);
ROLLBACK;
