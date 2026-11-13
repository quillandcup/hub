-- pgTAP tests for zoom_accounts and zoom_meeting_decisions (20270713000100): more than one Zoom account
-- feeds the Hub, and an admin keeps or ignores the meetings of the ones that are not all community business.
-- Admins read and write both, members see and change nothing, an account has a primary row the Bronze
-- columns default to, a decision is one per account, scope and key, and decisions are audited.
-- Runs in one transaction that is rolled back. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(14);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000d2a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zacc-member@example.test'),
  ('00000000-0000-4000-a000-00000000d2a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zacc-admin@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000d2a1', 'zacc-member@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000d2a4', 'zacc-admin@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

SELECT is(
  (SELECT default_policy FROM public.zoom_accounts WHERE id = 'zacc_Primary1Acct'), 'keep',
  'the primary account exists and keeps its meetings');
SELECT is(
  (SELECT credentials_prefix FROM public.zoom_accounts WHERE slug = 'primary'), 'ZOOM',
  'the primary account reads the existing ZOOM_* credentials');

-- Bronze rows written without an account (code that predates the column) are the primary account's.
INSERT INTO bronze.zoom_meetings (meeting_uuid, meeting_id, topic, start_time, data)
VALUES ('zacc-test-uuid-1', '111', 'Test', now(), '{}');
SELECT is(
  (SELECT zoom_account FROM bronze.zoom_meetings WHERE meeting_uuid = 'zacc-test-uuid-1'), 'zacc_Primary1Acct',
  'a meeting written without an account is the primary account''s');

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000d2a4", "email": "zacc-admin@example.test", "role": "authenticated"}', true);
INSERT INTO public.zoom_accounts (id, slug, label, default_policy, credentials_prefix)
VALUES ('zacc_TestSecond01', 'secondary', 'Second', 'exclude', 'ZOOM_SECONDARY');
INSERT INTO public.zoom_meeting_decisions (zoom_account, scope, zoom_key, decision, decided_by)
VALUES ('zacc_TestSecond01', 'instance', 'zacc-test-uuid-1', 'kept', '00000000-0000-4000-a000-00000000d2a4');
INSERT INTO result SELECT 'admin_accounts', to_jsonb(count(*)) FROM public.zoom_accounts;
INSERT INTO result SELECT 'admin_decisions', to_jsonb(count(*)) FROM public.zoom_meeting_decisions;

SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000d2a1", "email": "zacc-member@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'member_accounts', to_jsonb(count(*)) FROM public.zoom_accounts;
INSERT INTO result SELECT 'member_decisions', to_jsonb(count(*)) FROM public.zoom_meeting_decisions;
RESET ROLE;

SELECT is((SELECT value FROM result WHERE label = 'admin_accounts'), '2'::jsonb, 'an admin reads the accounts and can add one');
SELECT is((SELECT value FROM result WHERE label = 'admin_decisions'), '1'::jsonb, 'an admin reads and writes decisions');
SELECT is((SELECT value FROM result WHERE label = 'member_accounts'), '0'::jsonb, 'a member sees no accounts');
SELECT is((SELECT value FROM result WHERE label = 'member_decisions'), '0'::jsonb, 'a member sees no decisions');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000d2a1", "email": "zacc-member@example.test", "role": "authenticated"}', true);
SELECT throws_ok(
  $$INSERT INTO public.zoom_meeting_decisions (zoom_account, scope, zoom_key, decision) VALUES ('zacc_TestSecond01', 'series', '222', 'kept')$$,
  '42501', NULL, 'a member cannot keep a meeting');
SELECT throws_ok(
  $$INSERT INTO public.zoom_accounts (slug, label, credentials_prefix) VALUES ('sneaky', 'Sneaky', 'ZOOM_SNEAKY')$$,
  '42501', NULL, 'a member cannot add an account');
RESET ROLE;

SELECT throws_ok(
  $$INSERT INTO public.zoom_meeting_decisions (zoom_account, scope, zoom_key, decision) VALUES ('zacc_TestSecond01', 'instance', 'zacc-test-uuid-1', 'ignored')$$,
  '23505', NULL, 'one decision per account, scope and key');
SELECT throws_ok(
  $$INSERT INTO public.zoom_meeting_decisions (zoom_account, scope, zoom_key, decision) VALUES ('zacc_TestSecond01', 'galaxy', 'x', 'kept')$$,
  '23514', NULL, 'a decision has a known scope');
SELECT throws_ok(
  $$INSERT INTO public.zoom_accounts (slug, label, credentials_prefix) VALUES ('lowercase', 'Bad', 'zoom_lower')$$,
  '23514', NULL, 'the credentials prefix is an environment variable prefix');

SELECT is(
  (SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'zoom_meeting_decision' AND action = 'insert'), 1,
  'a decision is audited');
SELECT matches(
  obj_description('public.zoom_meeting_decisions'::regclass, 'pg_class'), '\[id prefix: zmdc\_\]$',
  'the decisions table comment records the id prefix');

SELECT * FROM finish(true);
ROLLBACK;
