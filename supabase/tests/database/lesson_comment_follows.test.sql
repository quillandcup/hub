-- pgTAP tests for 20270806000000_lesson_comment_follows.sql (lesson comments, phase 3):
--   * lesson_comment_follows and lesson_comment_reads are a member's own rows: read, follow and mark read as yourself only
--   * writing needs a lesson you can open (current access, open lesson); ended access and no access write nothing
--   * never while an admin previews as the member (sudo), and never signed out
--   * no hard delete for signed-in users; the service role can do everything
--   * one row per member and lesson; the id prefixes; deleting a member removes theirs
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(20);

-- Alice has access, Bob had access that ended, Carol has none, Dana is an admin.
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-0000000c02a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lf-alice@example.test'),
  ('00000000-0000-4000-a000-0000000c02a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lf-bob@example.test'),
  ('00000000-0000-4000-a000-0000000c02a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lf-carol@example.test'),
  ('00000000-0000-4000-a000-0000000c02a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lf-dana@example.test');
INSERT INTO public.user_profiles (id, email) VALUES
  ('00000000-0000-4000-a000-0000000c02a1', 'lf-alice@example.test'),
  ('00000000-0000-4000-a000-0000000c02a2', 'lf-bob@example.test'),
  ('00000000-0000-4000-a000-0000000c02a3', 'lf-carol@example.test'),
  ('00000000-0000-4000-a000-0000000c02a4', 'lf-dana@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-4000-a000-0000000c02a4', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;
INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('mbr_AAAAAAAAMfA1', 'Follow Alice', 'lf-alice@example.test', now(), 'active', '00000000-0000-4000-a000-0000000c02a1'),
  ('mbr_AAAAAAAAMfA2', 'Follow Bob', 'lf-bob@example.test', now(), 'active', '00000000-0000-4000-a000-0000000c02a2'),
  ('mbr_AAAAAAAAMfA3', 'Follow Carol', 'lf-carol@example.test', now(), 'active', '00000000-0000-4000-a000-0000000c02a3'),
  ('mbr_AAAAAAAAMfA4', 'Follow Dana', 'lf-dana@example.test', now(), 'active', '00000000-0000-4000-a000-0000000c02a4');

INSERT INTO public.courses (id, slug, title, source_key) VALUES
  ('crs_AAAAAAAAMfC1', 'pgtap-follows', 'PgTAP Follows', 'pgtap-follows');
INSERT INTO public.course_access (member_id, course_id, starts_at, ends_at, origin) VALUES
  ('mbr_AAAAAAAAMfA1', 'crs_AAAAAAAAMfC1', now() - interval '1 day', NULL, 'purchase'),
  ('mbr_AAAAAAAAMfA2', 'crs_AAAAAAAAMfC1', now() - interval '10 days', now() - interval '1 day', 'purchase');
INSERT INTO public.course_lessons (id, course_id, title, position, state, source_key) VALUES
  ('les_AAAAAAAAMfL1', 'crs_AAAAAAAAMfC1', 'Open lesson', 1, 'open', 'lf-open'),
  ('les_AAAAAAAAMfL2', 'crs_AAAAAAAAMfC1', 'Soon lesson', 2, 'coming_soon', 'lf-soon');

-- Rows made as the database owner (the server's service role does the same): Bob's from when he had access.
INSERT INTO public.lesson_comment_follows (id, member_id, lesson_id, following) VALUES
  ('cmfw_AAAAAAAAMf01', 'mbr_AAAAAAAAMfA2', 'les_AAAAAAAAMfL1', true);
INSERT INTO public.lesson_comment_reads (id, member_id, lesson_id) VALUES
  ('cmrd_AAAAAAAAMf01', 'mbr_AAAAAAAAMfA2', 'les_AAAAAAAAMfL1');

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated, anon;

-- Runs one statement as the current role and records how many rows it touched, or the error code.
CREATE FUNCTION pg_temp.try(p_label text, p_stmt text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE n int;
BEGIN
  EXECUTE p_stmt;
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO result VALUES (p_label, to_jsonb(n));
EXCEPTION WHEN others THEN
  INSERT INTO result VALUES (p_label, to_jsonb(SQLSTATE));
END
$f$;
GRANT EXECUTE ON FUNCTION pg_temp.try(text, text) TO authenticated, anon;

SET LOCAL ROLE authenticated;

-- Alice: current access.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-0000000c02a1", "email": "lf-alice@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'alice_sees_follows', to_jsonb(count(*)) FROM public.lesson_comment_follows;
INSERT INTO result SELECT 'alice_sees_reads', to_jsonb(count(*)) FROM public.lesson_comment_reads;
SELECT pg_temp.try('alice_follows', $$INSERT INTO public.lesson_comment_follows (id, member_id, lesson_id) VALUES ('cmfw_AAAAAAAAMf10', 'mbr_AAAAAAAAMfA1', 'les_AAAAAAAAMfL1')$$);
SELECT pg_temp.try('alice_follows_twice', $$INSERT INTO public.lesson_comment_follows (member_id, lesson_id) VALUES ('mbr_AAAAAAAAMfA1', 'les_AAAAAAAAMfL1')$$);
SELECT pg_temp.try('alice_follows_as_bob', $$INSERT INTO public.lesson_comment_follows (member_id, lesson_id) VALUES ('mbr_AAAAAAAAMfA2', 'les_AAAAAAAAMfL1')$$);
SELECT pg_temp.try('alice_follows_coming_soon', $$INSERT INTO public.lesson_comment_follows (member_id, lesson_id) VALUES ('mbr_AAAAAAAAMfA1', 'les_AAAAAAAAMfL2')$$);
SELECT pg_temp.try('alice_unfollows', $$UPDATE public.lesson_comment_follows SET following = false WHERE id = 'cmfw_AAAAAAAAMf10'$$);
SELECT pg_temp.try('alice_unfollows_bobs', $$UPDATE public.lesson_comment_follows SET following = false WHERE id = 'cmfw_AAAAAAAAMf01'$$);
SELECT pg_temp.try('alice_reads', $$INSERT INTO public.lesson_comment_reads (id, member_id, lesson_id) VALUES ('cmrd_AAAAAAAAMf10', 'mbr_AAAAAAAAMfA1', 'les_AAAAAAAAMfL1')$$);
SELECT pg_temp.try('alice_reads_as_bob', $$INSERT INTO public.lesson_comment_reads (member_id, lesson_id) VALUES ('mbr_AAAAAAAAMfA2', 'les_AAAAAAAAMfL2')$$);
SELECT pg_temp.try('alice_updates_read', $$UPDATE public.lesson_comment_reads SET last_seen_at = now() WHERE id = 'cmrd_AAAAAAAAMf10'$$);
SELECT pg_temp.try('alice_hard_deletes', $$DELETE FROM public.lesson_comment_follows WHERE id = 'cmfw_AAAAAAAAMf10'$$);

-- Bob: access ended yesterday, so he can neither follow nor mark read a new lesson, but still owns what he has.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-0000000c02a2", "email": "lf-bob@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'bob_sees_follows', to_jsonb(count(*)) FROM public.lesson_comment_follows;
SELECT pg_temp.try('bob_follows_again', $$INSERT INTO public.lesson_comment_follows (member_id, lesson_id) VALUES ('mbr_AAAAAAAAMfA2', 'les_AAAAAAAAMfL2')$$);
SELECT pg_temp.try('bob_unfollows_his', $$UPDATE public.lesson_comment_follows SET following = false WHERE id = 'cmfw_AAAAAAAAMf01'$$);

-- Carol: no access at all.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-0000000c02a3", "email": "lf-carol@example.test", "role": "authenticated"}', true);
SELECT pg_temp.try('carol_follows', $$INSERT INTO public.lesson_comment_follows (member_id, lesson_id) VALUES ('mbr_AAAAAAAAMfA3', 'les_AAAAAAAAMfL1')$$);
INSERT INTO result SELECT 'carol_sees', to_jsonb(count(*)) FROM public.lesson_comment_follows;

-- Sudo: Dana previewing as Alice. The header names the member; nothing may be written, and Dana reads only her own rows.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-0000000c02a4", "email": "lf-dana@example.test", "role": "authenticated"}', true);
SELECT set_config('request.headers', '{"x-acting-as": "00000000-0000-4000-a000-0000000c02a4:mbr_AAAAAAAAMfA1"}', true);
SELECT pg_temp.try('sudo_follows', $$INSERT INTO public.lesson_comment_follows (member_id, lesson_id) VALUES ('mbr_AAAAAAAAMfA4', 'les_AAAAAAAAMfL1')$$);
SELECT pg_temp.try('sudo_marks_read', $$INSERT INTO public.lesson_comment_reads (member_id, lesson_id) VALUES ('mbr_AAAAAAAAMfA4', 'les_AAAAAAAAMfL1')$$);
SELECT set_config('request.headers', '{}', true);

-- Signed out.
RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role": "anon"}', true);
SELECT pg_temp.try('anon_reads_follows', 'SELECT * FROM public.lesson_comment_follows');
SELECT pg_temp.try('anon_reads_reads', 'SELECT * FROM public.lesson_comment_reads');
RESET ROLE;

-- Reads: your own rows only.
SELECT is((SELECT value FROM result WHERE label = 'alice_sees_follows'), '0'::jsonb, 'a member never reads another member''s follows (Bob''s is there, Alice sees none of it)');
SELECT is((SELECT value FROM result WHERE label = 'alice_sees_reads'), '0'::jsonb, 'nor their read markers');
SELECT is((SELECT value FROM result WHERE label = 'bob_sees_follows'), '1'::jsonb, 'a member whose access ended still reads their own follow');
SELECT is((SELECT value FROM result WHERE label = 'carol_sees'), '0'::jsonb, 'a member with no rows reads none');

-- Following.
SELECT is((SELECT value FROM result WHERE label = 'alice_follows'), '1'::jsonb, 'a member follows a lesson she can open');
SELECT is((SELECT value FROM result WHERE label = 'alice_follows_twice'), '"23505"'::jsonb, 'once per member and lesson');
SELECT is((SELECT value FROM result WHERE label = 'alice_follows_as_bob'), '"42501"'::jsonb, 'never as someone else');
SELECT is((SELECT value FROM result WHERE label = 'alice_follows_coming_soon'), '"42501"'::jsonb, 'nor a lesson that is not open yet');
SELECT ok(
  (SELECT value = '1'::jsonb FROM result WHERE label = 'alice_unfollows')
  AND (SELECT NOT following FROM public.lesson_comment_follows WHERE id = 'cmfw_AAAAAAAAMf10'),
  'she unfollows by changing her own row');
SELECT is((SELECT value FROM result WHERE label = 'alice_unfollows_bobs'), '0'::jsonb, 'but never changes Bob''s');
SELECT is((SELECT value FROM result WHERE label = 'bob_follows_again'), '"42501"'::jsonb, 'ended access follows nothing new');
SELECT is((SELECT value FROM result WHERE label = 'carol_follows'), '"42501"'::jsonb, 'no access, no follow');
SELECT is((SELECT value FROM result WHERE label = 'bob_unfollows_his'), '1'::jsonb, 'but he can still stop following what he followed');

-- Reading.
SELECT ok(
  (SELECT value = '1'::jsonb FROM result WHERE label = 'alice_reads')
  AND (SELECT value = '1'::jsonb FROM result WHERE label = 'alice_updates_read')
  AND (SELECT value = '"42501"'::jsonb FROM result WHERE label = 'alice_reads_as_bob'),
  'a member marks a thread read and moves her own marker, never someone else''s');

-- Sudo and signed out.
SELECT ok(
  (SELECT value = '"42501"'::jsonb FROM result WHERE label = 'sudo_follows')
  AND (SELECT value = '"42501"'::jsonb FROM result WHERE label = 'sudo_marks_read'),
  'an admin previewing as a member can follow nothing and mark nothing read');
SELECT ok(
  (SELECT value = '"42501"'::jsonb FROM result WHERE label = 'anon_reads_follows')
  AND (SELECT value = '"42501"'::jsonb FROM result WHERE label = 'anon_reads_reads'),
  'signed-out visitors read neither table');

-- Grants and ids.
SELECT ok(
  (SELECT value = '"42501"'::jsonb FROM result WHERE label = 'alice_hard_deletes')
  AND NOT has_table_privilege('authenticated', 'public.lesson_comment_follows', 'DELETE')
  AND NOT has_table_privilege('authenticated', 'public.lesson_comment_reads', 'DELETE')
  AND NOT has_table_privilege('anon', 'public.lesson_comment_follows', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.lesson_comment_reads', 'SELECT'),
  'grants: no hard delete for signed-in users, nothing for anon');
SELECT ok(
  has_table_privilege('service_role', 'public.lesson_comment_follows', 'DELETE')
  AND has_table_privilege('service_role', 'public.lesson_comment_reads', 'DELETE')
  AND has_table_privilege('authenticated', 'public.lesson_comment_follows', 'INSERT')
  AND has_table_privilege('authenticated', 'public.lesson_comment_reads', 'UPDATE'),
  'grants: the service role does everything, members insert and update their own rows');
SELECT ok(
  (SELECT id LIKE 'cmfw\_%' ESCAPE '\' FROM public.lesson_comment_follows ORDER BY created_at DESC, id LIMIT 1)
  AND (SELECT id LIKE 'cmrd\_%' ESCAPE '\' FROM public.lesson_comment_reads ORDER BY id LIMIT 1),
  'ids carry their prefixes');

-- Removing a member removes their rows.
DELETE FROM public.members WHERE id = 'mbr_AAAAAAAAMfA2';
SELECT is(
  (SELECT count(*)::int FROM public.lesson_comment_follows WHERE member_id = 'mbr_AAAAAAAAMfA2')
  + (SELECT count(*)::int FROM public.lesson_comment_reads WHERE member_id = 'mbr_AAAAAAAAMfA2'),
  0,
  'a deleted member''s follows and read markers go with them');

SELECT * FROM finish(true);
ROLLBACK;
