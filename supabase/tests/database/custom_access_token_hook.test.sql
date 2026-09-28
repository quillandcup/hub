-- pgTAP test for public.custom_access_token_hook (20260926000900_add_role_to_access_token.sql).
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched.
-- Run with `npm run test:pgtap` (scripts/test-pgtap.sh; CI runs it in the test-db job). It runs
-- as supabase_admin, since tests here SET ROLE to roles postgres can't. finish(true) raises on
-- any "not ok", so a failed assertion fails the run.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(13);

-- Fixture users (fixed ids that nothing else uses; rolled back at the end).
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000a901', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'hook-admin@example.test'),
  ('00000000-0000-4000-a000-00000000a902', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'hook-member@example.test'),
  ('00000000-0000-4000-a000-00000000a903', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'hook-noprofile@example.test');

-- The signup trigger may already have created profile rows; set them explicitly either way.
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000a901', 'hook-admin@example.test', 'admin'),
  ('00000000-0000-4000-a000-00000000a902', 'hook-member@example.test', 'member')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
DELETE FROM public.user_profiles WHERE id = '00000000-0000-4000-a000-00000000a903';

CREATE TEMP TABLE hook_event(user_id uuid, event jsonb) ON COMMIT DROP;
INSERT INTO hook_event
SELECT id, jsonb_build_object(
  'user_id', id,
  'authentication_method', 'otp',
  'claims', jsonb_build_object(
    'aud', 'authenticated', 'exp', 4102444800, 'iat', 1700000000, 'sub', id,
    'email', email, 'phone', '', 'role', 'authenticated', 'aal', 'aal1',
    'session_id', '11111111-1111-4111-8111-111111111111', 'is_anonymous', false))
FROM auth.users
WHERE id IN ('00000000-0000-4000-a000-00000000a901', '00000000-0000-4000-a000-00000000a902', '00000000-0000-4000-a000-00000000a903');
GRANT SELECT ON hook_event TO supabase_auth_admin;

-- Call it the way Supabase Auth does: as supabase_auth_admin (exercises the EXECUTE grant,
-- the SELECT grant and the RLS policy on user_profiles). SET ROLE needs a superuser, hence
-- running this file as supabase_admin; assertions run after RESET ROLE because
-- supabase_auth_admin can't see pgTAP's schema.
SET LOCAL ROLE supabase_auth_admin;

CREATE TEMP TABLE hook_result ON COMMIT DROP AS
SELECT user_id, public.custom_access_token_hook(event) AS result, event FROM hook_event
UNION ALL
SELECT NULL, public.custom_access_token_hook(bad), bad
FROM (SELECT '{"user_id": "not-a-uuid", "claims": {"role": "authenticated"}}'::jsonb AS bad) AS b;

RESET ROLE;

SELECT is(
  (SELECT result -> 'claims' ->> 'app_role' FROM hook_result WHERE user_id = '00000000-0000-4000-a000-00000000a901'),
  'admin', 'admin profile → app_role "admin"');
SELECT is(
  (SELECT result -> 'claims' ->> 'app_role' FROM hook_result WHERE user_id = '00000000-0000-4000-a000-00000000a902'),
  'member', 'member profile → app_role "member"');
SELECT is(
  (SELECT result -> 'claims' -> 'app_role' FROM hook_result WHERE user_id = '00000000-0000-4000-a000-00000000a903'),
  'null'::jsonb, 'no profile row → app_role is JSON null (present, never admin)');
SELECT ok(
  (SELECT bool_and(result -> 'claims' ? 'app_role') FROM hook_result WHERE user_id IS NOT NULL),
  'every token gets the claim, so the proxy can skip its DB read');
SELECT is(
  (SELECT count(*)::int FROM hook_result WHERE user_id IS NOT NULL AND result -> 'claims' ->> 'role' = 'authenticated'),
  3, 'the reserved role claim stays "authenticated"');
SELECT is(
  (SELECT count(*)::int FROM hook_result WHERE user_id IS NOT NULL AND (result -> 'claims') - 'app_role' = event -> 'claims'),
  3, 'no other claim is added, removed or changed');
SELECT is(
  (SELECT count(*)::int FROM hook_result WHERE user_id IS NOT NULL AND result - 'claims' = event - 'claims'),
  3, 'the rest of the event is returned unchanged');

SELECT is(
  (SELECT result FROM hook_result WHERE user_id IS NULL),
  '{"user_id": "not-a-uuid", "claims": {"role": "authenticated"}}'::jsonb,
  'a lookup error returns the event untouched (claim absent) instead of blocking sign-in');

SELECT ok(has_function_privilege('supabase_auth_admin', 'public.custom_access_token_hook(jsonb)', 'EXECUTE'),
  'supabase_auth_admin can execute the hook');
SELECT ok(NOT has_function_privilege('authenticated', 'public.custom_access_token_hook(jsonb)', 'EXECUTE'),
  'authenticated cannot execute the hook');
SELECT ok(NOT has_function_privilege('anon', 'public.custom_access_token_hook(jsonb)', 'EXECUTE'),
  'anon cannot execute the hook');
SELECT ok(NOT has_function_privilege('service_role', 'public.custom_access_token_hook(jsonb)', 'EXECUTE'),
  'service_role cannot execute the hook (not exposed via /rpc)');
SELECT ok(NOT has_table_privilege('supabase_auth_admin', 'public.user_profiles', 'UPDATE'),
  'supabase_auth_admin only reads user_profiles');

SELECT * FROM finish(true);
ROLLBACK;
