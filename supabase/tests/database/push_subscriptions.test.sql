-- pgTAP tests for push_subscriptions (20261014000000): the table holds Web Push credentials, so
-- neither members nor admins nor anonymous callers can read or write it; only the server can.
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched.
-- Run with `npm run test:pgtap` (scripts/test-pgtap.sh; CI runs it in the test-db job).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(7);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000f3a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'push-alice@example.test'),
  ('00000000-0000-4000-a000-00000000f3a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'push-dana@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000f3a1', 'push-alice@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000f3a4', 'push-dana@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('00000000-0000-4000-a000-00000000f301', 'Push Alice', 'push-alice@example.test', now(), 'active');

-- Written as the server (this session is supabase_admin, like the service role).
INSERT INTO public.push_subscriptions (id, member_id, endpoint, p256dh, auth) VALUES
  ('00000000-0000-4000-a000-00000000f401', '00000000-0000-4000-a000-00000000f301',
   'https://push.example.test/alice-laptop', 'p256dh-key', 'auth-secret');

SELECT is(
  (SELECT count(*)::int FROM public.push_subscriptions WHERE deleted_at IS NULL), 1,
  'the server can read live subscriptions'
);

SELECT throws_ok(
  $$INSERT INTO public.push_subscriptions (member_id, endpoint, p256dh, auth) VALUES
    ('00000000-0000-4000-a000-00000000f301', 'https://push.example.test/alice-laptop', 'k', 'a')$$,
  '23505', NULL, 'an endpoint is stored once'
);

SELECT throws_ok(
  $$INSERT INTO public.push_subscriptions (member_id, endpoint, p256dh, auth) VALUES
    ('00000000-0000-4000-a000-00000000f301', '', 'k', 'a')$$,
  '23514', NULL, 'an empty endpoint is refused'
);

SET LOCAL ROLE authenticated;

-- As the member herself.
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000f3a1", "email": "push-alice@example.test", "role": "authenticated"}', true);
SELECT throws_ok($$SELECT * FROM public.push_subscriptions$$, '42501', NULL, 'a member cannot read subscriptions, even her own');
SELECT throws_ok(
  $$INSERT INTO public.push_subscriptions (member_id, endpoint, p256dh, auth) VALUES
    ('00000000-0000-4000-a000-00000000f301', 'https://push.example.test/other', 'k', 'a')$$,
  '42501', NULL, 'a member cannot add one directly'
);

-- As an admin.
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000f3a4", "email": "push-dana@example.test", "role": "authenticated"}', true);
SELECT throws_ok($$SELECT * FROM public.push_subscriptions$$, '42501', NULL, 'an admin cannot read subscriptions');

SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT * FROM public.push_subscriptions$$, '42501', NULL, 'anonymous callers cannot read subscriptions');

SELECT * FROM finish(true);
ROLLBACK;
