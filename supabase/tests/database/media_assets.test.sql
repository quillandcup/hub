-- pgTAP tests for 20270225100000_create_media_assets.sql: the media library table and its private
-- bucket. Shared assets are readable by every signed-in member and managed by staff; a member's own
-- assets are theirs (and staff's); a deleted asset is only for staff; signed-out visitors get nothing
-- (public assets are served by /api/media with the service role). Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(21);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000d1a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'media-alice@example.test'),
  ('00000000-0000-4000-a000-00000000d1a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'media-bob@example.test'),
  ('00000000-0000-4000-a000-00000000d1a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'media-admin@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000d1a1', 'media-alice@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000d1a2', 'media-bob@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000d1a3', 'media-admin@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
INSERT INTO public.members (id, name, email, status, joined_at, user_id) VALUES
  ('mbr_MediaTestAl1', 'Alice Example', 'media-alice@example.test', 'active', '2026-01-01', '00000000-0000-4000-a000-00000000d1a1'),
  ('mbr_MediaTestBo2', 'Bob Example', 'media-bob@example.test', 'active', '2026-01-01', '00000000-0000-4000-a000-00000000d1a2');

INSERT INTO public.media_assets (id, storage_path, mime_type, width, height, bytes, sha256, title, owner_member_id, deleted_at) VALUES
  ('media_MediaTestSh1', 'originals/shared/mt-1.png', 'image/png', 10, 10, 1, 'mt-sha-1', 'Shared', NULL, NULL),
  ('media_MediaTestSh2', 'originals/shared/mt-2.png', 'image/png', 10, 10, 1, 'mt-sha-2', 'Shared, deleted', NULL, now()),
  ('media_MediaTestAl1', 'originals/mbr_MediaTestAl1/mt-3.png', 'image/png', 10, 10, 1, 'mt-sha-3', 'Alice own', 'mbr_MediaTestAl1', NULL),
  ('media_MediaTestBo1', 'originals/mbr_MediaTestBo2/mt-4.png', 'image/png', 10, 10, 1, 'mt-sha-4', 'Bob own', 'mbr_MediaTestBo2', NULL);

SELECT is((SELECT public FROM storage.buckets WHERE id = 'media'), false, 'the media bucket is private');
SELECT is(
  (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
     AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%bucket_id = ''media''%'),
  0,
  'no storage policy opens the media bucket to API users'
);
SELECT ok(NOT has_table_privilege('anon', 'public.media_assets', 'SELECT'), 'signed-out visitors have no access to the table');

SET LOCAL ROLE authenticated;

-- Alice, a member
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000d1a1", "email": "media-alice@example.test", "role": "authenticated"}', true);
SELECT results_eq(
  $$ SELECT id FROM public.media_assets WHERE sha256 LIKE 'mt-sha-%' ORDER BY id $$,
  ARRAY['media_MediaTestAl1', 'media_MediaTestSh1']::text[],
  'a member reads the live shared assets and their own, not another member''s or a deleted one'
);
SELECT throws_ok(
  $$ INSERT INTO public.media_assets (storage_path, mime_type, width, height, bytes, sha256, title) VALUES ('originals/shared/mt-5.png', 'image/png', 1, 1, 1, 'mt-sha-5', 'Sneaky shared') $$,
  '42501', NULL, 'a member can''t add to the shared library'
);
SELECT throws_ok(
  $$ INSERT INTO public.media_assets (storage_path, mime_type, width, height, bytes, sha256, title, owner_member_id) VALUES ('originals/x/mt-6.png', 'image/png', 1, 1, 1, 'mt-sha-6', 'As Bob', 'mbr_MediaTestBo2') $$,
  '42501', NULL, 'nor as another member'
);
SELECT lives_ok(
  $$ INSERT INTO public.media_assets (storage_path, mime_type, width, height, bytes, sha256, title, owner_member_id) VALUES ('originals/mbr_MediaTestAl1/mt-7.png', 'image/png', 1, 1, 1, 'mt-sha-7', 'Alice again', 'mbr_MediaTestAl1') $$,
  'a member adds to their own library'
);
UPDATE public.media_assets SET title = 'Changed' WHERE id = 'media_MediaTestSh1';
UPDATE public.media_assets SET title = 'Alice renamed' WHERE id = 'media_MediaTestAl1';
SELECT is((SELECT title FROM public.media_assets WHERE id = 'media_MediaTestSh1'), 'Shared', 'a member can''t change a shared asset');
SELECT is((SELECT title FROM public.media_assets WHERE id = 'media_MediaTestAl1'), 'Alice renamed', 'but can change their own');
DELETE FROM public.media_assets WHERE id = 'media_MediaTestSh1';
SELECT is((SELECT count(*)::int FROM public.media_assets WHERE id = 'media_MediaTestSh1'), 1, 'and can''t delete a shared one');

-- Bob never sees Alice's
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000d1a2", "email": "media-bob@example.test", "role": "authenticated"}', true);
SELECT is((SELECT count(*)::int FROM public.media_assets WHERE owner_member_id = 'mbr_MediaTestAl1'), 0, 'another member can''t read a member''s own assets');

-- The admin
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000d1a3", "email": "media-admin@example.test", "role": "authenticated"}', true);
SELECT is((SELECT count(*)::int FROM public.media_assets WHERE sha256 LIKE 'mt-sha-%'), 5, 'staff read everything, a deleted asset included');
SELECT lives_ok(
  $$ INSERT INTO public.media_assets (storage_path, mime_type, width, height, bytes, sha256, title) VALUES ('originals/shared/mt-8.png', 'image/png', 1, 1, 1, 'mt-sha-8', 'Staff shared') $$,
  'staff add to the shared library'
);
UPDATE public.media_assets SET title = 'Staff renamed' WHERE id = 'media_MediaTestSh1';
SELECT is((SELECT title FROM public.media_assets WHERE id = 'media_MediaTestSh1'), 'Staff renamed', 'and change a shared asset');

RESET ROLE;

-- A member's cover is theirs until a book uses it: then every signed-in member can read it (the Bookshelf shows
-- it to all), but a project's pre-publish cover, and a cover that was deleted, stay with their owner.
INSERT INTO public.media_assets (id, storage_path, mime_type, width, height, bytes, sha256, title, owner_member_id, deleted_at) VALUES
  ('media_MediaTestBk1', 'originals/mbr_MediaTestBo2/bk-1.png', 'image/png', 10, 10, 1, 'bk-sha-1', 'Bob book cover', 'mbr_MediaTestBo2', NULL),
  ('media_MediaTestPj1', 'originals/mbr_MediaTestBo2/bk-2.png', 'image/png', 10, 10, 1, 'bk-sha-2', 'Bob project cover', 'mbr_MediaTestBo2', NULL),
  ('media_MediaTestBk3', 'originals/mbr_MediaTestBo2/bk-3.png', 'image/png', 10, 10, 1, 'bk-sha-3', 'Bob deleted book cover', 'mbr_MediaTestBo2', now());
INSERT INTO public.member_books (member_id, title, cover_url, cover_asset_id, purchase_url, published_date) VALUES
  ('mbr_MediaTestBo2', 'Bob book', '/api/media/media_MediaTestBk1/book_cover_shelf', 'media_MediaTestBk1', 'https://example.com/buy', '2026-01-01'),
  ('mbr_MediaTestBo2', 'Bob deleted-cover book', '/api/media/media_MediaTestBk3/book_cover_shelf', 'media_MediaTestBk3', 'https://example.com/buy', '2026-01-02');
INSERT INTO public.writing_projects (member_id, title, phase, cover_asset_id) VALUES
  ('mbr_MediaTestBo2', 'Bob project', 'drafting', 'media_MediaTestPj1');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000d1a1", "email": "media-alice@example.test", "role": "authenticated"}', true);
SELECT results_eq(
  $$ SELECT id FROM public.media_assets WHERE sha256 LIKE 'bk-sha-%' ORDER BY id $$,
  ARRAY['media_MediaTestBk1']::text[],
  'another member reads a published book''s cover, but not a project''s cover or a deleted one'
);
SELECT is((SELECT count(*)::int FROM public.media_assets WHERE id = 'media_MediaTestPj1'), 0, 'a project''s cover is private to its owner');
UPDATE public.media_assets SET title = 'Hijacked' WHERE id = 'media_MediaTestBk1';
RESET ROLE;
SELECT is((SELECT title FROM public.media_assets WHERE id = 'media_MediaTestBk1'), 'Bob book cover', 'but can''t change it');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000d1a2", "email": "media-bob@example.test", "role": "authenticated"}', true);
SELECT is((SELECT count(*)::int FROM public.media_assets WHERE sha256 IN ('bk-sha-1', 'bk-sha-2')), 2, 'the owner reads both their book cover and their project cover');
RESET ROLE;
SELECT throws_ok(
  $$ DELETE FROM public.media_assets WHERE id = 'media_MediaTestBk1' $$,
  '23503', NULL, 'a cover a book uses can''t be hard-deleted'
);

SELECT throws_ok(
  $$ INSERT INTO public.media_assets (storage_path, mime_type, width, height, bytes, sha256, title) VALUES ('originals/shared/mt-9.png', 'image/png', 1, 1, 1, 'mt-sha-1', 'Same bytes') $$,
  '23505', NULL, 'the same bytes can''t be in the shared library twice'
);
SELECT throws_ok(
  $$ INSERT INTO public.media_assets (storage_path, mime_type, width, height, bytes, sha256, title, focal_x) VALUES ('originals/shared/mt-10.png', 'image/png', 1, 1, 1, 'mt-sha-10', 'Half a focal point', 0.5) $$,
  '23514', NULL, 'a focal point has both coordinates or neither'
);

SELECT * FROM finish(true);
ROLLBACK;
