-- pgTAP tests for 20261219000000_help_images_bucket.sql: help article screenshots live in a private bucket
-- that no API user can reach directly (the /help/images route checks sign-in, then serves the file).
-- Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(4);

SELECT is((SELECT public FROM storage.buckets WHERE id = 'help-images'), false, 'the help-images bucket is private');
SELECT is((SELECT file_size_limit FROM storage.buckets WHERE id = 'help-images'), 5242880::bigint, 'and limited to 5 MB a file');
SELECT is((SELECT allowed_mime_types FROM storage.buckets WHERE id = 'help-images'), ARRAY['image/png', 'image/jpeg', 'image/webp'], 'and takes images only');
SELECT is(
  (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
     AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%help-images%'),
  0,
  'no storage policy opens the help-images bucket to API users'
);

SELECT * FROM finish(true);
ROLLBACK;
