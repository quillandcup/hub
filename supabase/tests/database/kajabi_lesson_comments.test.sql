-- pgTAP tests for bronze.kajabi_lesson_comments (20270405100000): comments hold members' names and words, so
-- admins read them, members and signed-out visitors do not, and only the service role writes.
-- Runs in one transaction that is rolled back. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(8);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-0000000bc0b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'klc-member@example.test'),
  ('00000000-0000-4000-a000-0000000bc0b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'klc-admin@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-0000000bc0b1', 'klc-member@example.test', 'member'),
  ('00000000-0000-4000-a000-0000000bc0b2', 'klc-admin@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO bronze.kajabi_lesson_comments (course_kajabi_id, lesson_kajabi_id, comment_key, author_name, body)
VALUES ('pgtap-course', '111', '1', 'Ada Example', 'Hello');

SELECT throws_ok(
  $$INSERT INTO bronze.kajabi_lesson_comments (course_kajabi_id, lesson_kajabi_id, comment_key, author_name, body) VALUES ('pgtap-course', '111', '1', 'Bo Sample', 'Again')$$,
  '23505', NULL, 'one row per lesson and comment key');
SELECT lives_ok(
  $$INSERT INTO bronze.kajabi_lesson_comments (course_kajabi_id, lesson_kajabi_id, comment_key, parent_comment_key, author_name, body) VALUES ('pgtap-course', '111', '2', '1', 'Bo Sample', 'Reply')$$,
  'the same key in another lesson, or a new key in this one, is fine');

SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT count(*) FROM bronze.kajabi_lesson_comments$$, '42501', NULL, 'anon cannot read');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000bc0b1","role":"authenticated"}', true);
SELECT is((SELECT count(*) FROM bronze.kajabi_lesson_comments WHERE course_kajabi_id = 'pgtap-course'), 0::bigint, 'a member sees no rows');
SELECT throws_ok(
  $$INSERT INTO bronze.kajabi_lesson_comments (course_kajabi_id, lesson_kajabi_id, comment_key, author_name, body) VALUES ('pgtap-course', '111', '3', 'Cy Demo', 'x')$$,
  '42501', NULL, 'a member cannot insert');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000bc0b2","role":"authenticated"}', true);
SELECT is((SELECT count(*) FROM bronze.kajabi_lesson_comments WHERE course_kajabi_id = 'pgtap-course'), 2::bigint, 'an admin sees the rows');
SELECT throws_ok(
  $$INSERT INTO bronze.kajabi_lesson_comments (course_kajabi_id, lesson_kajabi_id, comment_key, author_name, body) VALUES ('pgtap-course', '111', '3', 'Cy Demo', 'x')$$,
  '42501', NULL, 'an admin cannot insert');
SELECT throws_ok(
  $$UPDATE bronze.kajabi_lesson_comments SET body = 'edited'$$,
  '42501', NULL, 'an admin cannot update');
RESET ROLE;

SELECT * FROM finish(true);
ROLLBACK;
