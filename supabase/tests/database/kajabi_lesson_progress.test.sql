-- pgTAP tests for bronze.kajabi_lesson_progress (20270226000000): admins read it, members and
-- signed-out visitors do not, and only the service role writes. Also the imported_from column.
-- Runs in one transaction that is rolled back. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(9);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-0000000bc0a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'klp-member@example.test'),
  ('00000000-0000-4000-a000-0000000bc0a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'klp-admin@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-0000000bc0a1', 'klp-member@example.test', 'member'),
  ('00000000-0000-4000-a000-0000000bc0a2', 'klp-admin@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO bronze.kajabi_lesson_progress (course_kajabi_id, email, kajabi_lesson_id, completed)
VALUES ('pgtap-course', 'ada@example.test', '111', true);

SELECT throws_ok(
  $$INSERT INTO bronze.kajabi_lesson_progress (course_kajabi_id, email, kajabi_lesson_id, completed, percent) VALUES ('pgtap-course', 'bo@example.test', '111', false, 101)$$,
  '23514', NULL, 'a percent above 100 is rejected');
SELECT throws_ok(
  $$INSERT INTO bronze.kajabi_lesson_progress (course_kajabi_id, email, kajabi_lesson_id, completed) VALUES ('pgtap-course', 'Bo@Example.test', '111', false)$$,
  '23514', NULL, 'an email that is not lowercased is rejected');
SELECT throws_ok(
  $$INSERT INTO bronze.kajabi_lesson_progress (course_kajabi_id, email, kajabi_lesson_id, completed) VALUES ('pgtap-course', 'ada@example.test', '111', false)$$,
  '23505', NULL, 'one row per course, student and lesson');

SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT count(*) FROM bronze.kajabi_lesson_progress$$, '42501', NULL, 'anon cannot read');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000bc0a1","role":"authenticated"}', true);
SELECT is((SELECT count(*) FROM bronze.kajabi_lesson_progress WHERE course_kajabi_id = 'pgtap-course'), 0::bigint, 'a member sees no rows');
SELECT throws_ok(
  $$INSERT INTO bronze.kajabi_lesson_progress (course_kajabi_id, email, kajabi_lesson_id, completed) VALUES ('pgtap-course', 'cy@example.test', '111', true)$$,
  '42501', NULL, 'a member cannot insert');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000bc0a2","role":"authenticated"}', true);
SELECT is((SELECT count(*) FROM bronze.kajabi_lesson_progress WHERE course_kajabi_id = 'pgtap-course'), 1::bigint, 'an admin sees the rows');
SELECT throws_ok(
  $$INSERT INTO bronze.kajabi_lesson_progress (course_kajabi_id, email, kajabi_lesson_id, completed) VALUES ('pgtap-course', 'cy@example.test', '111', true)$$,
  '42501', NULL, 'an admin cannot insert');
RESET ROLE;

SELECT has_column('public', 'lesson_progress', 'imported_from', 'lesson_progress records which import wrote a row');

SELECT * FROM finish(true);
ROLLBACK;
