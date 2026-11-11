-- pgTAP tests for 20270618000000_unfurl_images_bucket.sql: the chat picture cache is a private, size- and
-- type-limited bucket that no API user can reach directly. Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(4);

SELECT is((SELECT public FROM storage.buckets WHERE id = 'unfurl-images'), false, 'the unfurl-images bucket is private');
SELECT is((SELECT file_size_limit FROM storage.buckets WHERE id = 'unfurl-images'), 5242880::bigint, 'limited to 5 MB an object');
SELECT ok(NOT ('image/svg+xml'::text = ANY ((SELECT allowed_mime_types FROM storage.buckets WHERE id = 'unfurl-images'))), 'and never SVG');
SELECT is(
  (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
     AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%unfurl-images%'),
  0,
  'no storage policy opens the unfurl-images bucket to API users'
);

SELECT * FROM finish(true);
ROLLBACK;
