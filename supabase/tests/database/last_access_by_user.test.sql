-- pgTAP tests for last_access_by_user() (20270601000000): the latest event per user, none for a user without
-- events, and no access for signed-in users. Rolled back. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(4);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-0000000f0b01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'last-ann@example.test'),
  ('00000000-0000-4000-a000-0000000f0b02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'last-bea@example.test');

INSERT INTO public.access_events (user_id, path, is_page, created_at) VALUES
  ('00000000-0000-4000-a000-0000000f0b01', '/dashboard', true,  '2026-10-06 14:00:00+00'),
  ('00000000-0000-4000-a000-0000000f0b01', '/api/x',     false, '2026-10-09 09:00:00+00'),
  ('00000000-0000-4000-a000-0000000f0b01', '/courses',   true,  '2026-10-07 10:00:00+00');

SELECT is(
  (SELECT last_access_at FROM public.last_access_by_user() WHERE user_id = '00000000-0000-4000-a000-0000000f0b01'),
  '2026-10-09 09:00:00+00'::timestamptz, 'the latest event counts, API calls included');
SELECT is(
  (SELECT count(*)::int FROM public.last_access_by_user() WHERE user_id = '00000000-0000-4000-a000-0000000f0b02'),
  0, 'a user with no events is absent');

SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT * FROM public.last_access_by_user()$$, '42501', NULL, 'a signed-in user cannot call it');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT lives_ok($$SELECT * FROM public.last_access_by_user()$$, 'the service role can');
RESET ROLE;

SELECT * FROM finish(true);
ROLLBACK;
