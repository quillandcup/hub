-- pgTAP tests for in_app_notifications (20261004000000): the member and admins read; the member
-- can only dismiss their own (dismissed_at), never write anything else; only the server inserts.
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched.
-- Run with `npm run test:pgtap` (scripts/test-pgtap.sh; CI runs it in the test-db job).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(7);

-- Alice and Bob are regular members, Dana an admin. Fixed ids nothing else uses.
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000f1a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'inapp-alice@example.test'),
  ('00000000-0000-4000-a000-00000000f1a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'inapp-bob@example.test'),
  ('00000000-0000-4000-a000-00000000f1a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'inapp-dana@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000f1a1', 'inapp-alice@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000f1a2', 'inapp-bob@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000f1a4', 'inapp-dana@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('00000000-0000-4000-a000-00000000f101', 'InApp Alice', 'inapp-alice@example.test', now(), 'active'),
  ('00000000-0000-4000-a000-00000000f102', 'InApp Bob', 'inapp-bob@example.test', now(), 'active'),
  ('00000000-0000-4000-a000-00000000f104', 'InApp Dana', 'inapp-dana@example.test', now(), 'active');

-- Written as the server (this session is supabase_admin, like the service role).
INSERT INTO public.in_app_notifications (id, member_id, kind, ref, text, url) VALUES
  ('00000000-0000-4000-a000-00000000f201', '00000000-0000-4000-a000-00000000f101', 'prickle_checkin', 'p1', 'Check in?', '/prickles/p1'),
  ('00000000-0000-4000-a000-00000000f202', '00000000-0000-4000-a000-00000000f102', 'prickle_checkin', 'p1', 'Check in?', '/prickles/p1');

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;

SET LOCAL ROLE authenticated;

-- As Alice: sees only her own; dismisses hers; trying Bob's changes nothing.
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000f1a1", "email": "inapp-alice@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'alice_sees', jsonb_agg(id) FROM public.in_app_notifications;
UPDATE public.in_app_notifications SET dismissed_at = now() WHERE id = '00000000-0000-4000-a000-00000000f201';
UPDATE public.in_app_notifications SET dismissed_at = now() WHERE id = '00000000-0000-4000-a000-00000000f202';

-- As Dana (admin): sees everyone's.
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000f1a4", "email": "inapp-dana@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'admin_sees', to_jsonb(count(*)) FROM public.in_app_notifications
  WHERE id IN ('00000000-0000-4000-a000-00000000f201', '00000000-0000-4000-a000-00000000f202');
RESET ROLE;

SELECT is(
  (SELECT value FROM result WHERE label = 'alice_sees'),
  '["00000000-0000-4000-a000-00000000f201"]'::jsonb,
  'a member sees only their own in-app notifications'
);
SELECT is((SELECT value FROM result WHERE label = 'admin_sees'), '2'::jsonb, 'admins see everyone''s');
SELECT isnt(
  (SELECT dismissed_at FROM public.in_app_notifications WHERE id = '00000000-0000-4000-a000-00000000f201'),
  NULL,
  'a member can dismiss their own'
);
SELECT is(
  (SELECT dismissed_at FROM public.in_app_notifications WHERE id = '00000000-0000-4000-a000-00000000f202'),
  NULL,
  'a member cannot dismiss someone else''s'
);

SELECT throws_ok(
  $$SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f1a1", "email": "inapp-alice@example.test", "role": "authenticated"}', true);
    UPDATE public.in_app_notifications SET text = 'Edited' WHERE id = '00000000-0000-4000-a000-00000000f201'$$,
  '42501',
  NULL,
  'a member can change only dismissed_at'
);
RESET ROLE;

SELECT throws_ok(
  $$SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f1a1", "email": "inapp-alice@example.test", "role": "authenticated"}', true);
    INSERT INTO public.in_app_notifications (member_id, kind, text)
    VALUES ('00000000-0000-4000-a000-00000000f101', 'prickle_checkin', 'Hi')$$,
  '42501',
  NULL,
  'members cannot create in-app notifications'
);
RESET ROLE;

DELETE FROM public.members WHERE id = '00000000-0000-4000-a000-00000000f102';
SELECT is(
  (SELECT count(*)::int FROM public.in_app_notifications WHERE id = '00000000-0000-4000-a000-00000000f202'),
  0,
  'deleting a member deletes their in-app notifications'
);

SELECT * FROM finish(true);
ROLLBACK;
