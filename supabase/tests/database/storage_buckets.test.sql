-- pgTAP tests for the storage buckets' access (20270306000000_tighten_storage_buckets.sql and the migrations that
-- made each bucket). The server-only buckets (media, help-images, course-files, slack-files) have no policy on
-- purpose: with row level security on, that leaves them to the service role, and the app streams what a member may
-- see. A policy that mentions one would open it to the API, so none may. book-covers has no policy and nothing
-- writes to it; feedback-screenshots takes one member's own PNG, small. Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(9);

-- How many policies on storage.objects name this bucket.
CREATE FUNCTION pg_temp.policies_naming(bucket text) RETURNS int LANGUAGE sql AS $$
  SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%' || quote_literal(bucket) || '%'
$$;

SELECT is(pg_temp.policies_naming('media'), 0, 'media has no policy: only the service role reaches it');
SELECT is(pg_temp.policies_naming('help-images'), 0, 'help-images has no policy');
SELECT is(pg_temp.policies_naming('course-files'), 0, 'course-files has no policy');
SELECT is(pg_temp.policies_naming('slack-files'), 0, 'slack-files has no policy');
SELECT is(pg_temp.policies_naming('book-covers'), 0, 'book-covers has no policy: a member can no longer write to it');
SELECT is((SELECT file_size_limit FROM storage.buckets WHERE id = 'slack-files'), 20971520::bigint, 'slack-files is limited to 20 MB, as the capture step is');
SELECT is((SELECT file_size_limit FROM storage.buckets WHERE id = 'feedback-screenshots'), 5242880::bigint, 'a feedback screenshot is limited to 5 MB');
SELECT is((SELECT allowed_mime_types FROM storage.buckets WHERE id = 'feedback-screenshots'), ARRAY['image/png']::text[], 'and to a PNG');
SELECT is(pg_temp.policies_naming('feedback-screenshots'), 2, 'feedback-screenshots keeps its two policies: a member uploads to their own folder; they and staff read');

SELECT * FROM finish(true);
ROLLBACK;
