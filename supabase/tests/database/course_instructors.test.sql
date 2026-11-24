-- pgTAP tests for 20271126000000_course_instructors.sql (the Instructor badge means the course's instructors):
--   * course_instructors: admins add and remove, members read the instructors of a course they have access to, nobody else
--   * one entry per instructor added or removed in the audit log, as the admin, labelled with the course; none for the server's own writes
--   * one row per course and member; the id prefix; grants; removing a member or a course removes the rows
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(17);

-- Alice has access to the course, Carol has none, Dana is an admin, Eve is the instructor.
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-0000000c03a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ci-alice@example.test'),
  ('00000000-0000-4000-a000-0000000c03a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ci-carol@example.test'),
  ('00000000-0000-4000-a000-0000000c03a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ci-dana@example.test');
INSERT INTO public.user_profiles (id, email) VALUES
  ('00000000-0000-4000-a000-0000000c03a1', 'ci-alice@example.test'),
  ('00000000-0000-4000-a000-0000000c03a3', 'ci-carol@example.test'),
  ('00000000-0000-4000-a000-0000000c03a4', 'ci-dana@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-4000-a000-0000000c03a4', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;
INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('mbr_AAAAAAAAIn01', 'Instr Alice', 'ci-alice@example.test', now(), 'active', '00000000-0000-4000-a000-0000000c03a1'),
  ('mbr_AAAAAAAAIn03', 'Instr Carol', 'ci-carol@example.test', now(), 'active', '00000000-0000-4000-a000-0000000c03a3'),
  ('mbr_AAAAAAAAIn04', 'Instr Dana', 'ci-dana@example.test', now(), 'active', '00000000-0000-4000-a000-0000000c03a4'),
  ('mbr_AAAAAAAAIn05', 'Instr Eve', 'ci-eve@example.test', now(), 'active', NULL),
  ('mbr_AAAAAAAAIn06', 'Instr Fay', 'ci-fay@example.test', now(), 'active', NULL);

INSERT INTO public.courses (id, slug, title, source_key) VALUES
  ('crs_AAAAAAAAIn01', 'pgtap-instructors', 'PgTAP Instructors', 'pgtap-instructors'),
  ('crs_AAAAAAAAIn02', 'pgtap-instructors-gone', 'PgTAP Instructors Gone', 'pgtap-instructors-gone');
INSERT INTO public.course_access (member_id, course_id, starts_at, ends_at, origin) VALUES
  ('mbr_AAAAAAAAIn01', 'crs_AAAAAAAAIn01', now() - interval '1 day', NULL, 'purchase');

-- A row made as the database owner (the server's service role does the same): no signed-in user, so no audit entry.
INSERT INTO public.course_instructors (id, course_id, member_id) VALUES
  ('cinst_AAAAAAAAIn01', 'crs_AAAAAAAAIn01', 'mbr_AAAAAAAAIn06');

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

-- Dana (admin): adds and removes instructors.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-0000000c03a4", "email": "ci-dana@example.test", "role": "authenticated"}', true);
SELECT pg_temp.try('admin_adds', $$INSERT INTO public.course_instructors (id, course_id, member_id) VALUES ('cinst_AAAAAAAAIn02', 'crs_AAAAAAAAIn01', 'mbr_AAAAAAAAIn05')$$);
SELECT pg_temp.try('admin_adds_twice', $$INSERT INTO public.course_instructors (course_id, member_id) VALUES ('crs_AAAAAAAAIn01', 'mbr_AAAAAAAAIn05')$$);
INSERT INTO result SELECT 'admin_sees', to_jsonb(count(*)) FROM public.course_instructors WHERE course_id = 'crs_AAAAAAAAIn01';
SELECT pg_temp.try('admin_removes_fay', $$DELETE FROM public.course_instructors WHERE id = 'cinst_AAAAAAAAIn01'$$);

-- Alice (current access): reads the course's instructors, changes nothing.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-0000000c03a1", "email": "ci-alice@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'alice_sees', to_jsonb(count(*)) FROM public.course_instructors;
SELECT pg_temp.try('alice_adds', $$INSERT INTO public.course_instructors (course_id, member_id) VALUES ('crs_AAAAAAAAIn01', 'mbr_AAAAAAAAIn01')$$);
SELECT pg_temp.try('alice_removes', $$DELETE FROM public.course_instructors WHERE id = 'cinst_AAAAAAAAIn02'$$);
SELECT pg_temp.try('alice_edits', $$UPDATE public.course_instructors SET member_id = 'mbr_AAAAAAAAIn01' WHERE id = 'cinst_AAAAAAAAIn02'$$);

-- Carol (no access): sees none and changes none.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-0000000c03a3", "email": "ci-carol@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'carol_sees', to_jsonb(count(*)) FROM public.course_instructors;
SELECT pg_temp.try('carol_adds', $$INSERT INTO public.course_instructors (course_id, member_id) VALUES ('crs_AAAAAAAAIn01', 'mbr_AAAAAAAAIn03')$$);

-- Signed out.
RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role": "anon"}', true);
SELECT pg_temp.try('anon_reads', 'SELECT * FROM public.course_instructors');
RESET ROLE;

SELECT is((SELECT value FROM result WHERE label = 'admin_adds'), '1'::jsonb, 'an admin adds an instructor');
SELECT is((SELECT value FROM result WHERE label = 'admin_adds_twice'), '"23505"'::jsonb, 'once per course and member');
SELECT is((SELECT value FROM result WHERE label = 'admin_sees'), '2'::jsonb, 'an admin reads the course''s instructors');
SELECT is((SELECT value FROM result WHERE label = 'admin_removes_fay'), '1'::jsonb, 'an admin removes an instructor');
SELECT is((SELECT value FROM result WHERE label = 'alice_sees'), '1'::jsonb, 'a member with access reads who teaches the course');
SELECT ok(
  (SELECT value = '"42501"'::jsonb FROM result WHERE label = 'alice_adds')
  AND (SELECT value = '0'::jsonb FROM result WHERE label = 'alice_removes')
  AND (SELECT value = '"42501"'::jsonb FROM result WHERE label = 'alice_edits'),
  'but a member neither adds, removes nor changes an instructor');
SELECT ok(
  (SELECT value = '0'::jsonb FROM result WHERE label = 'carol_sees')
  AND (SELECT value = '"42501"'::jsonb FROM result WHERE label = 'carol_adds'),
  'a member with no access sees no instructor and adds none');
SELECT is((SELECT value FROM result WHERE label = 'anon_reads'), '"42501"'::jsonb, 'signed-out visitors read nothing');

-- The audit log: one entry for each instructor added or removed, as the admin, labelled with the course; none for the owner's own insert.
SELECT is(
  (SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'course_instructor'),
  2,
  'two entries: the admin''s add and the admin''s remove, and none for the row made without a signed-in user');
SELECT ok(
  (SELECT count(*) = 1 FROM public.audit_log
    WHERE entity_type = 'course_instructor' AND entity_id = 'cinst_AAAAAAAAIn02' AND action = 'insert'
      AND changed_by = '00000000-0000-4000-a000-0000000c03a4' AND actor_kind = 'staff'
      AND entity_label = 'PgTAP Instructors' AND member_id = 'mbr_AAAAAAAAIn05')
  AND (SELECT count(*) = 1 FROM public.audit_log
    WHERE entity_type = 'course_instructor' AND entity_id = 'cinst_AAAAAAAAIn01' AND action = 'delete'
      AND changed_by = '00000000-0000-4000-a000-0000000c03a4' AND entity_label = 'PgTAP Instructors'),
  'each names the admin, the course and the member');

-- Grants, ids.
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.course_instructors', 'UPDATE')
  AND NOT has_table_privilege('anon', 'public.course_instructors', 'SELECT')
  AND has_table_privilege('authenticated', 'public.course_instructors', 'INSERT')
  AND has_table_privilege('authenticated', 'public.course_instructors', 'DELETE'),
  'grants: signed-in users insert and delete (row-level security limits it to admins), never update; nothing for anon');
SELECT ok(
  has_table_privilege('service_role', 'public.course_instructors', 'SELECT')
  AND has_table_privilege('service_role', 'public.course_instructors', 'INSERT')
  AND has_table_privilege('service_role', 'public.course_instructors', 'UPDATE')
  AND has_table_privilege('service_role', 'public.course_instructors', 'DELETE'),
  'grants: the service role does everything');
SELECT ok(
  (SELECT id LIKE 'cinst\_%' ESCAPE '\' FROM public.course_instructors ORDER BY id LIMIT 1)
  AND (SELECT public.new_id('cinst') LIKE 'cinst\_%' ESCAPE '\'),
  'ids carry the cinst_ prefix');
SELECT matches(
  obj_description('public.course_instructors'::regclass, 'pg_class'),
  '\[id prefix: cinst_\]',
  'the table comment records the id prefix');

-- Removing a member or a course removes their rows.
INSERT INTO public.course_instructors (course_id, member_id) VALUES ('crs_AAAAAAAAIn02', 'mbr_AAAAAAAAIn06'), ('crs_AAAAAAAAIn02', 'mbr_AAAAAAAAIn05');
DELETE FROM public.members WHERE id = 'mbr_AAAAAAAAIn06';
SELECT is(
  (SELECT count(*)::int FROM public.course_instructors WHERE member_id = 'mbr_AAAAAAAAIn06'),
  0,
  'removing a member removes the courses they teach');
DELETE FROM public.courses WHERE id = 'crs_AAAAAAAAIn02';
SELECT is(
  (SELECT count(*)::int FROM public.course_instructors WHERE course_id = 'crs_AAAAAAAAIn02'),
  0,
  'removing a course removes its instructors');
SELECT ok(
  EXISTS (SELECT 1 FROM public.member_data_handling WHERE table_name = 'course_instructors' AND column_name = 'member_id' AND action = 'delete'),
  'a removal request deletes the instructor rows (member_data_handling)');

SELECT * FROM finish();
ROLLBACK;
