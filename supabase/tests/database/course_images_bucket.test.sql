-- pgTAP tests for 20270214000300_course_images_bucket.sql: course images live in a private bucket that no
-- API user can reach directly (the image route checks the caller, then streams the object).
-- Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(5);

SELECT is((SELECT public FROM storage.buckets WHERE id = 'course-images'), false, 'the course-images bucket is private');
SELECT is((SELECT file_size_limit FROM storage.buckets WHERE id = 'course-images'), 10485760::bigint, 'and limited to 10 MB an image');
SELECT is(
  (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
     AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%course-images%'),
  0,
  'no storage policy opens the course-images bucket to API users'
);
SELECT has_column('public', 'courses', 'thumbnail_path', 'courses records where its cover copy is');
SELECT has_column('public', 'course_lessons', 'thumbnail_source', 'lessons record the source they were copied from');

SELECT * FROM finish(true);
ROLLBACK;
