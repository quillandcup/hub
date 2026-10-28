-- pgTAP tests for bronze.kajabi_product_progress (20270224000000): admins read it, members and
-- signed-out visitors do not, and only the service role writes.
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched.
-- Run with `pnpm test:pgtap` (scripts/test-pgtap.sh; CI runs it in the test-db job).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(8);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-0000000bb0a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kpp-member@example.test'),
  ('00000000-0000-4000-a000-0000000bb0a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kpp-admin@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-0000000bb0a1', 'kpp-member@example.test', 'member'),
  ('00000000-0000-4000-a000-0000000bb0a2', 'kpp-admin@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO bronze.kajabi_product_progress (course_kajabi_id, email, percent, logins, started_on, import_batch)
VALUES ('pgtap-course', 'ada@example.test', 62.5, 3, '2026-01-05', 'batch-1');

-- The shape: percent bounds, canonical email, one row per student and course.
SELECT throws_ok(
  $$INSERT INTO bronze.kajabi_product_progress (course_kajabi_id, email, percent, import_batch) VALUES ('pgtap-course', 'bo@example.test', 101, 'b')$$,
  '23514', NULL, 'a percent above 100 is rejected');
SELECT throws_ok(
  $$INSERT INTO bronze.kajabi_product_progress (course_kajabi_id, email, percent, import_batch) VALUES ('pgtap-course', 'Bo@Example.test', 5, 'b')$$,
  '23514', NULL, 'an email that is not lowercased is rejected');
SELECT throws_ok(
  $$INSERT INTO bronze.kajabi_product_progress (course_kajabi_id, email, percent, import_batch) VALUES ('pgtap-course', 'ada@example.test', 5, 'b')$$,
  '23505', NULL, 'one row per course and email');

-- Anonymous: no access to the table at all.
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT count(*) FROM bronze.kajabi_product_progress$$, '42501', NULL, 'anon cannot read');
RESET ROLE;

-- A member has the grant but RLS shows them nothing, and they cannot write.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000bb0a1","role":"authenticated"}', true);
SELECT is((SELECT count(*) FROM bronze.kajabi_product_progress WHERE course_kajabi_id = 'pgtap-course'), 0::bigint, 'a member sees no rows');
SELECT throws_ok(
  $$INSERT INTO bronze.kajabi_product_progress (course_kajabi_id, email, percent, import_batch) VALUES ('pgtap-course', 'cy@example.test', 5, 'b')$$,
  '42501', NULL, 'a member cannot insert');
RESET ROLE;

-- An admin reads, but still cannot write: the import route writes with the service role.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000bb0a2","role":"authenticated"}', true);
SELECT is((SELECT count(*) FROM bronze.kajabi_product_progress WHERE course_kajabi_id = 'pgtap-course'), 1::bigint, 'an admin sees the rows');
SELECT throws_ok(
  $$INSERT INTO bronze.kajabi_product_progress (course_kajabi_id, email, percent, import_batch) VALUES ('pgtap-course', 'cy@example.test', 5, 'b')$$,
  '42501', NULL, 'an admin cannot insert');
RESET ROLE;

SELECT * FROM finish(true);
ROLLBACK;
