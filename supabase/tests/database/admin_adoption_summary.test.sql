-- pgTAP tests for 20270416000000_admin_adoption_summary.sql: the adoption numbers at the top of /admin/analytics.
--   * active members, those with an account, and those seen in the last day, 7 and 30 days;
--   * a cancelled member isn't counted, and staff viewing as a member don't count as that member being seen;
--   * only admins get a row.
-- The database is shared, so the numbers are compared with what the function says before the fixtures go in.
-- Runs in one transaction that is rolled back. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(8);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000ad01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adopt-admin@example.test'),
  ('00000000-0000-4000-a000-00000000ad02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adopt-today@example.test'),
  ('00000000-0000-4000-a000-00000000ad03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adopt-tenday@example.test'),
  ('00000000-0000-4000-a000-00000000ad04', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adopt-gone@example.test'),
  ('00000000-0000-4000-a000-00000000ad05', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adopt-plain@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000ad01', 'adopt-admin@example.test', 'admin'),
  ('00000000-0000-4000-a000-00000000ad05', 'adopt-plain@example.test', 'member')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

CREATE TEMP TABLE before_counts(active_members bigint, with_account bigint, seen_today bigint, seen_7d bigint, seen_30d bigint) ON COMMIT DROP;
CREATE TEMP TABLE after_counts(active_members bigint, with_account bigint, seen_today bigint, seen_7d bigint, seen_30d bigint) ON COMMIT DROP;
GRANT INSERT ON before_counts, after_counts TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000ad01", "email": "adopt-admin@example.test", "role": "authenticated"}', true);
INSERT INTO before_counts SELECT * FROM public.admin_adoption_summary();
RESET ROLE;

INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('mbr_ADPAAAAAAAA1', 'Seen Today', 'adopt-today@example.test', now(), 'active', '00000000-0000-4000-a000-00000000ad02'),
  ('mbr_ADPAAAAAAAA2', 'Seen Ten Days Ago', 'adopt-tenday@example.test', now(), 'active', '00000000-0000-4000-a000-00000000ad03'),
  ('mbr_ADPAAAAAAAA3', 'No Account', 'adopt-noaccount@example.test', now(), 'active', NULL),
  ('mbr_ADPAAAAAAAA4', 'Cancelled', 'adopt-gone@example.test', now(), 'cancelled', '00000000-0000-4000-a000-00000000ad04');
INSERT INTO public.access_events (user_id, path, is_page, created_at, acting_as_member_id) VALUES
  ('00000000-0000-4000-a000-00000000ad02', '/dashboard', true, now() - interval '2 hours', NULL),
  ('00000000-0000-4000-a000-00000000ad03', '/dashboard', true, now() - interval '10 days', NULL),
  -- Staff looking as this member, recently: doesn't make the member "seen" today.
  ('00000000-0000-4000-a000-00000000ad03', '/dashboard', true, now() - interval '1 hour', 'mbr_ADPAAAAAAAA2'),
  ('00000000-0000-4000-a000-00000000ad04', '/dashboard', true, now() - interval '1 hour', NULL);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000ad01", "email": "adopt-admin@example.test", "role": "authenticated"}', true);
INSERT INTO after_counts SELECT * FROM public.admin_adoption_summary();
RESET ROLE;

SELECT is((SELECT count(*) FROM before_counts), 1::bigint, 'an admin gets one row');
SELECT is((SELECT a.active_members - b.active_members FROM after_counts a, before_counts b), 3::bigint, 'three new active members count; the cancelled one does not');
SELECT is((SELECT a.with_account - b.with_account FROM after_counts a, before_counts b), 2::bigint, 'two of them have an account');
SELECT is((SELECT a.seen_today - b.seen_today FROM after_counts a, before_counts b), 1::bigint, 'one was seen in the last day, and staff viewing as another does not add them');
SELECT is((SELECT a.seen_7d - b.seen_7d FROM after_counts a, before_counts b), 1::bigint, 'and in 7 days');
SELECT is((SELECT a.seen_30d - b.seen_30d FROM after_counts a, before_counts b), 2::bigint, 'two in 30 days');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000ad05", "email": "adopt-plain@example.test", "role": "authenticated"}', true);
SELECT is((SELECT count(*) FROM public.admin_adoption_summary()), 0::bigint, 'a member gets nothing');
RESET ROLE;
SELECT ok(NOT has_function_privilege('anon', 'public.admin_adoption_summary()', 'EXECUTE'), 'a signed-out visitor can''t run it');

SELECT * FROM finish(true);
ROLLBACK;
