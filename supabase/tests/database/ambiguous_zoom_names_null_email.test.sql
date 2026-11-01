-- pgTAP test for 20261222000000_ambiguous_zoom_names_null_email_unique.sql.
-- Zoom names almost never come with an email, and a NULL email used to defeat the unique
-- constraint, so every reprocess inserted a new row. Rolled back at the end.
-- Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(11);

SELECT lives_ok(
  $$SELECT public.upsert_ambiguous_zoom_name('Ada', NULL, ARRAY['mbr_b001'], 3)$$,
  'first upsert without an email inserts');
SELECT lives_ok(
  $$SELECT public.upsert_ambiguous_zoom_name('Ada', NULL, ARRAY['mbr_b001', 'mbr_b002'], 2)$$,
  'second upsert for the same name without an email conflicts instead of inserting');

SELECT is(
  (SELECT count(*) FROM public.ambiguous_zoom_names WHERE zoom_name = 'Ada' AND zoom_email IS NULL),
  1::bigint,
  'one row per name when the email is NULL');
SELECT is(
  (SELECT occurrence_count FROM public.ambiguous_zoom_names WHERE zoom_name = 'Ada'),
  2,
  'occurrence_count is the latest observed count, so reprocessing does not inflate it');
SELECT is(
  (SELECT array_length(candidate_member_ids, 1) FROM public.ambiguous_zoom_names WHERE zoom_name = 'Ada'),
  2,
  'candidates follow the latest upsert');

-- An admin ignoring a name has to stick: the next reprocess must not bring it back as unresolved.
UPDATE public.ambiguous_zoom_names SET status = 'ignored' WHERE zoom_name = 'Ada';
SELECT public.upsert_ambiguous_zoom_name('Ada', NULL, ARRAY['mbr_b001'], 1);
SELECT is(
  (SELECT status FROM public.ambiguous_zoom_names WHERE zoom_name = 'Ada'),
  'ignored',
  'an ignored name stays ignored when it is seen again');

-- A name with an email is still a different key from the same name without one.
SELECT public.upsert_ambiguous_zoom_name('Ada', 'ada@example.test', ARRAY['mbr_b001'], 1);
SELECT is(
  (SELECT count(*) FROM public.ambiguous_zoom_names WHERE zoom_name = 'Ada'),
  2::bigint,
  'the same name with an email is a separate row');

-- The migration's cleanup of rows duplicated before the fix. Production had many rows per name; the
-- constraint now forbids that, so drop it inside this transaction, recreate the duplicates, run the
-- same statement the migration runs, and check what survives. Keep this statement identical to the
-- one in the migration.
ALTER TABLE public.ambiguous_zoom_names DROP CONSTRAINT ambiguous_zoom_names_zoom_name_zoom_email_key;
INSERT INTO public.ambiguous_zoom_names (zoom_name, zoom_email, candidate_member_ids, first_seen_at, last_seen_at, occurrence_count, status) VALUES
  ('Zed', NULL, '{}', '2026-01-01', '2026-01-02', 2, 'unresolved'),
  ('Zed', NULL, '{}', '2026-01-03', '2026-01-05', 3, 'unresolved'),
  ('Zed', NULL, '{}', '2026-01-04', '2026-01-04', 4, 'ignored'),
  ('Yan', NULL, '{}', '2026-02-01', '2026-02-02', 1, 'unresolved'),
  ('Yan', NULL, '{}', '2026-02-03', '2026-02-09', 1, 'unresolved');

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY zoom_name, coalesce(zoom_email, '')
      ORDER BY (status = 'unresolved'), last_seen_at DESC, id
    ) AS rn,
    sum(coalesce(occurrence_count, 1)) OVER w AS total_count,
    min(first_seen_at) OVER w AS first_seen,
    max(last_seen_at) OVER w AS last_seen
  FROM public.ambiguous_zoom_names
  WINDOW w AS (PARTITION BY zoom_name, coalesce(zoom_email, ''))
),
survivors AS (
  UPDATE public.ambiguous_zoom_names t
  SET occurrence_count = r.total_count,
      first_seen_at = r.first_seen,
      last_seen_at = r.last_seen
  FROM ranked r
  WHERE t.id = r.id AND r.rn = 1
  RETURNING t.id
)
DELETE FROM public.ambiguous_zoom_names t
USING ranked r
WHERE t.id = r.id AND r.rn > 1;

SELECT is(
  (SELECT count(*) FROM public.ambiguous_zoom_names WHERE zoom_name IN ('Zed', 'Yan')),
  2::bigint,
  'cleanup leaves one row per name');
SELECT results_eq(
  $$SELECT status, occurrence_count, first_seen_at::date, last_seen_at::date
    FROM public.ambiguous_zoom_names WHERE zoom_name = 'Zed'$$,
  $$VALUES ('ignored'::text, 9, '2026-01-01'::date, '2026-01-05'::date)$$,
  'cleanup keeps the ignored row, with summed counts and the widest date range');
SELECT results_eq(
  $$SELECT status, occurrence_count, last_seen_at::date FROM public.ambiguous_zoom_names WHERE zoom_name = 'Yan'$$,
  $$VALUES ('unresolved'::text, 2, '2026-02-09'::date)$$,
  'cleanup of unresolved duplicates sums the counts');
SELECT lives_ok(
  $$ALTER TABLE public.ambiguous_zoom_names
    ADD CONSTRAINT ambiguous_zoom_names_zoom_name_zoom_email_key UNIQUE NULLS NOT DISTINCT (zoom_name, zoom_email)$$,
  'the constraint can be added once the duplicates are gone');

SELECT * FROM finish(true);
ROLLBACK;
