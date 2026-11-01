-- pgTAP tests for 20261112000500_course_files_bucket.sql: lesson downloads live in a private bucket
-- that no API user can reach directly (the lesson page checks access, then signs a short-lived link).
-- Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(3);

SELECT is((SELECT public FROM storage.buckets WHERE id = 'course-files'), false, 'the course-files bucket is private');
SELECT is((SELECT file_size_limit FROM storage.buckets WHERE id = 'course-files'), 52428800::bigint, 'and limited to 50 MB a file');
SELECT is(
  (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
     AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%course-files%'),
  0,
  'no storage policy opens the course-files bucket to API users'
);

SELECT * FROM finish(true);
ROLLBACK;
