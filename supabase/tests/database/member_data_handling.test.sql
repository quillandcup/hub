-- pgTAP tests for 20270321000000_member_data_handling.sql: every table that points at a member has a decision for
-- what a removal request does to it, so a new member-owned table can't be added without one.
--   * every foreign key to members(id) has a row in member_data_handling;
--   * every row names a foreign key that exists (no stale entries after a rename or drop);
--   * member_data_report counts a member's rows per table and changes nothing;
--   * only admins read the catalog, and only the service role runs the report.
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched.
-- Run with `pnpm test:pgtap` (scripts/test-pgtap.sh; CI runs it in the test-db job).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(8);

-- Every foreign key column that references members(id), as (table, column).
CREATE TEMP TABLE member_fks ON COMMIT DROP AS
SELECT c.conrelid::regclass::text AS table_name, a.attname AS column_name
FROM pg_constraint c
JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
WHERE c.contype = 'f' AND c.confrelid = 'public.members'::regclass;

SELECT is(
  (SELECT string_agg(f.table_name || '.' || f.column_name, ', ' ORDER BY f.table_name, f.column_name)
   FROM member_fks f
   WHERE NOT EXISTS (SELECT 1 FROM public.member_data_handling h WHERE h.table_name = f.table_name AND h.column_name = f.column_name)),
  NULL,
  'every foreign key to members has a decision in member_data_handling (add a row for a new member-owned table)');

SELECT is(
  (SELECT string_agg(h.table_name || '.' || h.column_name, ', ' ORDER BY h.table_name, h.column_name)
   FROM public.member_data_handling h
   WHERE NOT EXISTS (SELECT 1 FROM member_fks f WHERE f.table_name = h.table_name AND f.column_name = h.column_name)),
  NULL,
  'every row in member_data_handling names a real foreign key to members');

SELECT is((SELECT count(*)::int FROM public.member_data_handling WHERE action NOT IN ('repoint', 'delete', 'null')), 0, 'no table is marked keep without the routine having a reason to');

INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('mbr_AAAAAAAAfbA1', 'Report Member', 'report-member@example.test', now(), 'active');
INSERT INTO public.writing_projects (id, member_id, title) VALUES ('prj_AAAAAAAAfb11', 'mbr_AAAAAAAAfbA1', 'A project');

SELECT is(
  (SELECT row_count FROM public.member_data_report('mbr_AAAAAAAAfbA1') WHERE table_name = 'writing_projects' AND column_name = 'member_id'),
  1::bigint, 'the report counts a member''s rows in a table');
SELECT is(
  (SELECT count(*)::int FROM public.member_data_report('mbr_AAAAAAAAfbA1')),
  (SELECT count(*)::int FROM public.member_data_handling), 'and has a line for every decision');
SELECT is((SELECT count(*)::int FROM public.writing_projects WHERE member_id = 'mbr_AAAAAAAAfbA1'), 1, 'the report changes nothing');

SELECT ok(NOT has_function_privilege('authenticated', 'public.member_data_report(text)', 'EXECUTE'), 'a signed-in member can''t run the report');
SELECT ok(has_function_privilege('service_role', 'public.member_data_report(text)', 'EXECUTE'), 'the service role can');

SELECT * FROM finish(true);
ROLLBACK;
