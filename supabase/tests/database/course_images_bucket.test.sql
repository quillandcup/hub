-- pgTAP tests for the old course-images bucket (20270214000300_course_images_bucket.sql) and the columns that
-- pointed into it. Course images now live in the media library (20270302000000); the bucket is empty and nothing
-- reads or writes it, and the path columns are gone (20270305000000). The bucket can only be deleted through the
-- Storage API, so it stays in a fresh database: these tests make sure it is still closed to API users and that the
-- dropped columns stay dropped. Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(8);

SELECT is((SELECT public FROM storage.buckets WHERE id = 'course-images'), false, 'the course-images bucket is private');
SELECT is((SELECT file_size_limit FROM storage.buckets WHERE id = 'course-images'), 10485760::bigint, 'and limited to 10 MB an image');
SELECT is(
  (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
     AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%course-images%'),
  0,
  'no storage policy opens the course-images bucket to API users'
);
SELECT hasnt_column('public', 'courses', 'thumbnail_path', 'a course no longer records a path in the old bucket for its cover');
SELECT hasnt_column('public', 'courses', 'hero_path', 'or its banner');
SELECT hasnt_column('public', 'course_modules', 'poster_path', 'a module no longer records one for its poster');
SELECT hasnt_column('public', 'course_lessons', 'thumbnail_path', 'nor a lesson for its thumbnail');
SELECT has_column('public', 'course_lessons', 'thumbnail_source', 'a lesson still records the source link its image was copied from');

SELECT * FROM finish(true);
ROLLBACK;
