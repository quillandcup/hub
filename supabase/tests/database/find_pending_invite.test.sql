-- pgTAP test for public.find_pending_invite (20260929000100_create_find_pending_invite.sql).
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched.
-- Run with `npm run test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(9);

INSERT INTO auth.users (id, instance_id, aud, role, email, invited_at, email_confirmed_at, deleted_at) VALUES
  ('00000000-0000-4000-a000-00000000b901', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pending-invite@example.test', now() - interval '2 hours', NULL, NULL),
  ('00000000-0000-4000-a000-00000000b902', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'accepted-invite@example.test', now() - interval '2 hours', now(), NULL),
  ('00000000-0000-4000-a000-00000000b903', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'never-invited@example.test', NULL, NULL, NULL),
  ('00000000-0000-4000-a000-00000000b904', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'deleted-invite@example.test', now() - interval '2 hours', NULL, now());

SELECT is(
  (SELECT user_id FROM public.find_pending_invite('pending-invite@example.test')),
  '00000000-0000-4000-a000-00000000b901'::uuid, 'finds an invited, unconfirmed user');
SELECT is(
  (SELECT user_id FROM public.find_pending_invite('  Pending-Invite@Example.TEST ')),
  '00000000-0000-4000-a000-00000000b901'::uuid, 'matches case- and whitespace-insensitively');
SELECT ok(
  (SELECT invited_at FROM public.find_pending_invite('pending-invite@example.test')) IS NOT NULL,
  'returns invited_at for the resend cooldown');
SELECT is_empty($$SELECT * FROM public.find_pending_invite('accepted-invite@example.test')$$,
  'ignores users who already accepted');
SELECT is_empty($$SELECT * FROM public.find_pending_invite('never-invited@example.test')$$,
  'ignores users who were never invited');
SELECT is_empty($$SELECT * FROM public.find_pending_invite('deleted-invite@example.test')$$,
  'ignores deleted users');
SELECT is_empty($$SELECT * FROM public.find_pending_invite('nobody@example.test')$$,
  'unknown email → no row');

SELECT ok(has_function_privilege('service_role', 'public.find_pending_invite(text)', 'EXECUTE'),
  'service_role can execute it');
SELECT ok(NOT has_function_privilege('anon', 'public.find_pending_invite(text)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.find_pending_invite(text)', 'EXECUTE'),
  'anon and authenticated cannot (it reveals pending invites)');

SELECT * FROM finish(true);
ROLLBACK;
