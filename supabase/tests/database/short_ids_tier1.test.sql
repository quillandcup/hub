-- pgTAP tests for the Tier 1 short id conversion (20261215000000): each Tier 1 table has a text
-- id defaulting to its own prefix, every column that references one is text too, and a new row
-- gets an id in the right shape.
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched.
-- Run with `npm run test:pgtap` (scripts/test-pgtap.sh; CI runs it in the test-db job).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(6);

CREATE TEMP TABLE t1(tbl text PRIMARY KEY, prefix text);
INSERT INTO t1 VALUES
  ('members', 'mbr'), ('prickles', 'prkl'), ('prickle_types', 'prty'), ('prickle_commitments', 'cmt'),
  ('writing_projects', 'prj'), ('member_books', 'book'), ('events', 'evt'), ('programs', 'prg'),
  ('chat_messages', 'msg'), ('chat_channels', 'chn'), ('segments', 'seg'), ('badge_types', 'bdgt'),
  ('courses', 'crs'), ('course_modules', 'mod'), ('course_lessons', 'les'), ('event_photos', 'photo'),
  ('course_lesson_files', 'file');

SELECT is(
  (SELECT count(*)::int FROM t1 JOIN information_schema.columns c
     ON c.table_schema = 'public' AND c.table_name = t1.tbl AND c.column_name = 'id' AND c.data_type = 'text'),
  17,
  'all 17 Tier 1 tables have a text id');

SELECT is(
  (SELECT count(*)::int FROM t1 JOIN information_schema.columns c
     ON c.table_schema = 'public' AND c.table_name = t1.tbl AND c.column_name = 'id'
    WHERE c.column_default = format('new_id(%L::text)', t1.prefix)),
  17,
  'each id defaults to new_id with its own prefix');

SELECT is(
  (SELECT string_agg(c.conrelid::regclass || '.' || a.attname, ', ')
     FROM pg_constraint c
     JOIN pg_class pc ON pc.oid = c.confrelid AND pc.relnamespace = 'public'::regnamespace
     JOIN t1 ON t1.tbl = pc.relname
     JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.contype = 'f' AND a.atttypid <> 'text'::regtype),
  NULL,
  'no foreign key into a Tier 1 table is still uuid');

SELECT is(
  (SELECT count(*)::int FROM t1
    WHERE obj_description(format('public.%I', t1.tbl)::regclass, 'pg_class') IS NULL
       OR obj_description(format('public.%I', t1.tbl)::regclass, 'pg_class') NOT LIKE '%[id prefix: ' || t1.prefix || '\_]'),
  0,
  'each table records its prefix in its comment');

INSERT INTO public.chat_channels (kind, visibility, name) VALUES ('channel', 'public', 'short-ids-test');
SELECT matches(
  (SELECT id FROM public.chat_channels WHERE name = 'short-ids-test'),
  '^chn_[1-9A-HJ-NP-Za-km-z]{12}$',
  'a new row gets a prefixed id');

SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT * FROM public.storage_path_moves$$, '42501', NULL, 'the storage move queue is not readable by members');
RESET ROLE;

SELECT * FROM finish(true);
ROLLBACK;
