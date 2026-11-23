-- pgTAP tests for 20271121000000_milestone_photos.sql (docs/product/FINISHERS.md, "Photos"):
--   * the bucket is private, takes only a small WebP and has no storage policy, so no member can write or read it directly;
--   * a photo path must be in the member's own folder; a description needs a photo and is short;
--   * a member can neither write a photo path (no grant, and a guard on INSERT) nor touch another member's description;
--   * the audit log says that a photo changed, never its path or its description;
--   * the pictured readers return a photo only with a step the viewer may see: a private milestone returns nothing, whoever
--     calls (an admin included), the web reader is the globe only, and Published carries the photo of its book;
--   * member_book_photos is read by its member only and can be described, not rewritten, by them.
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(34);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-0000000fb1a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ph-vera@example.test'),
  ('00000000-0000-4000-a000-0000000fb1a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ph-wade@example.test'),
  ('00000000-0000-4000-a000-0000000fb1a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ph-admin@example.test');
INSERT INTO public.user_profiles (id, email) VALUES
  ('00000000-0000-4000-a000-0000000fb1a1', 'ph-vera@example.test'),
  ('00000000-0000-4000-a000-0000000fb1a2', 'ph-wade@example.test'),
  ('00000000-0000-4000-a000-0000000fb1a3', 'ph-admin@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-4000-a000-0000000fb1a3', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;
INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('mbr_phVera000001', 'Vera Photos', 'ph-vera@example.test', now(), 'active', '00000000-0000-4000-a000-0000000fb1a1'),
  ('mbr_phWade000001', 'Wade Photos', 'ph-wade@example.test', now(), 'active', '00000000-0000-4000-a000-0000000fb1a2');
INSERT INTO public.member_books (id, member_id, title, cover_url, published_date) VALUES
  ('book_phVera00001', 'mbr_phVera000001', 'Vera Fake Book', 'https://example.test/c.png', '2026-03-09');

-- The bucket.
SELECT is((SELECT public FROM storage.buckets WHERE id = 'milestone-photos'), false, 'the bucket is private: no public address for a photo');
SELECT is((SELECT file_size_limit FROM storage.buckets WHERE id = 'milestone-photos'), 5242880::bigint, 'it is limited to 5 MB');
SELECT is((SELECT allowed_mime_types FROM storage.buckets WHERE id = 'milestone-photos'), ARRAY['image/webp']::text[], 'and to a WebP, the one thing the server makes');
SELECT is(
  (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%milestone-photos%'),
  0, 'it has no storage policy at all: no member, signed in or not, can read or write it through the API; only the server (service role)');

-- Fixtures are written the way the server writes them (service role).
SELECT set_config('request.jwt.claims', '{"role": "service_role"}', true);
INSERT INTO public.member_milestones (id, member_id, kind, source, status, confirmed_at, title, visibility, photo_path, photo_alt) VALUES
  ('mlst_phGlobe0001', 'mbr_phVera000001', 'the_end', 'member', 'confirmed', now(), 'A Globe Fake Work', 'public', 'mbr_phVera000001/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1.webp', 'Globe alt'),
  ('mlst_phHouse0001', 'mbr_phVera000001', 'the_end', 'member', 'confirmed', now(), 'A House Fake Work', 'community', 'mbr_phVera000001/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2.webp', 'House alt'),
  ('mlst_phLock00001', 'mbr_phVera000001', 'the_end', 'member', 'confirmed', now(), 'A Lock Fake Work', 'private', 'mbr_phVera000001/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa3.webp', 'Lock alt');
INSERT INTO public.member_book_photos (book_id, member_id, photo_path, photo_alt) VALUES
  ('book_phVera00001', 'mbr_phVera000001', 'mbr_phVera000001/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa4.webp', 'Book alt');
SELECT set_config('request.jwt.claims', '', true);

-- The checks on the columns.
SELECT throws_ok(
  $$UPDATE public.member_milestones SET photo_path = 'mbr_phWade000001/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa5.webp' WHERE id = 'mlst_phGlobe0001'$$,
  '23514', NULL, 'a photo in another member''s folder is refused');
SELECT throws_ok(
  $$UPDATE public.member_milestones SET photo_path = 'mbr_phVera000001/x.png' WHERE id = 'mlst_phGlobe0001'$$,
  '23514', NULL, 'and only a .webp file');
SELECT throws_ok(
  $$INSERT INTO public.member_milestones (id, member_id, kind, source, status, confirmed_at, title, photo_alt) VALUES ('mlst_phAlt0000001', 'mbr_phVera000001', 'publish_ready', 'member', 'confirmed', now(), 'No Photo Fake Work', 'a description with no photo')$$,
  '23514', NULL, 'a description needs a photo');
SELECT throws_ok(
  format($$UPDATE public.member_milestones SET photo_alt = %L WHERE id = 'mlst_phGlobe0001'$$, repeat('x', 301)),
  '23514', NULL, 'and is at most 300 characters');
SELECT throws_ok(
  $$INSERT INTO public.member_book_photos (book_id, member_id, photo_path) VALUES ('book_phVera00001', 'mbr_phVera000001', 'mbr_phVera000001/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa6.webp')$$,
  '23505', NULL, 'a book has one photo');
SELECT throws_ok(
  $$UPDATE public.member_book_photos SET photo_path = 'mbr_phWade000001/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa6.webp' WHERE book_id = 'book_phVera00001'$$,
  '23514', NULL, 'a book photo in another member''s folder is refused');

-- A member cannot write the path: not on an update (no grant) and not when adding a milestone (the guard).
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-0000000fb1a1", "email": "ph-vera@example.test", "role": "authenticated"}', true);
SELECT throws_ok(
  $$UPDATE public.member_milestones SET photo_path = 'mbr_phVera000001/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa9.webp' WHERE id = 'mlst_phGlobe0001'$$,
  '42501', NULL, 'a member cannot write a photo path: no grant on the column');
SELECT throws_ok(
  $$INSERT INTO public.member_milestones (id, member_id, kind, source, status, confirmed_at, title, photo_path) VALUES ('mlst_phSelf000001', 'mbr_phVera000001', 'publish_ready', 'member', 'confirmed', now(), 'Self Photo Fake Work', 'mbr_phVera000001/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa8.webp')$$,
  '42501', NULL, 'nor name one when adding a milestone: the guard on INSERT');
SELECT lives_ok(
  $$INSERT INTO public.member_milestones (id, member_id, kind, source, status, confirmed_at, title) VALUES ('mlst_phSelf000002', 'mbr_phVera000001', 'publish_ready', 'member', 'confirmed', now(), 'Self No Photo Fake Work')$$,
  'a member still adds a milestone with no photo');
UPDATE public.member_milestones SET photo_alt = 'Me, at my desk' WHERE id = 'mlst_phGlobe0001';
SELECT is((SELECT photo_alt FROM public.member_milestones WHERE id = 'mlst_phGlobe0001'), 'Me, at my desk', 'a member describes their own photo');
UPDATE public.member_book_photos SET photo_alt = 'Holding my book' WHERE book_id = 'book_phVera00001';
SELECT is((SELECT photo_alt FROM public.member_book_photos WHERE book_id = 'book_phVera00001'), 'Holding my book', 'and the photo on their book');
SELECT throws_ok(
  $$UPDATE public.member_book_photos SET photo_path = 'mbr_phVera000001/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa7.webp' WHERE book_id = 'book_phVera00001'$$,
  '42501', NULL, 'but cannot rewrite the path of a book photo');
SELECT throws_ok(
  $$INSERT INTO public.member_book_photos (book_id, member_id, photo_path) VALUES ('book_phVera00001', 'mbr_phVera000001', 'mbr_phVera000001/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa7.webp')$$,
  '42501', NULL, 'or add one');
RESET ROLE;

-- Another member cannot describe it or read the book photo row.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-0000000fb1a2", "email": "ph-wade@example.test", "role": "authenticated"}', true);
UPDATE public.member_milestones SET photo_alt = 'Not mine' WHERE id = 'mlst_phHouse0001';
UPDATE public.member_book_photos SET photo_alt = 'Not mine' WHERE book_id = 'book_phVera00001';
SELECT is((SELECT count(*)::int FROM public.member_book_photos), 0, 'another member cannot read the row of a book photo');
RESET ROLE;
SELECT is((SELECT photo_alt FROM public.member_milestones WHERE id = 'mlst_phHouse0001'), 'House alt', 'and cannot describe another member''s milestone photo');
SELECT is((SELECT photo_alt FROM public.member_book_photos WHERE book_id = 'book_phVera00001'), 'Holding my book', 'or the photo on their book');

-- The Activity Log says a photo changed, never where it is or what it shows.
SELECT set_config('request.jwt.claims', '{"role": "service_role"}', true);
UPDATE public.member_milestones SET photo_path = 'mbr_phVera000001/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp', photo_alt = 'A very private description' WHERE id = 'mlst_phLock00001';
SELECT set_config('request.jwt.claims', '', true);
SELECT is(
  (SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'member_milestone' AND (changes::text LIKE '%A very private description%' OR changes::text LIKE '%aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp%' OR changes::text LIKE '%Lock alt%')),
  0, 'neither the path nor the description of a photo is in the Activity Log');
SELECT is(
  (SELECT changes -> 'photo_path' ->> 'new' FROM public.audit_log WHERE entity_type = 'member_milestone' AND entity_id = 'mlst_phLock00001' AND changes ? 'photo_path' ORDER BY id DESC LIMIT 1),
  '[redacted]', 'it is logged as changed, never with its value');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'member_milestone' AND entity_id = 'mlst_phGlobe0001' AND changes::text LIKE '%mbr_phVera000001/aaaa%'), 0, 'the insert of a photo is logged without its path too');

-- The readers: another member sees the house and the globe photos, never the lock one.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-0000000fb1a2", "email": "ph-wade@example.test", "role": "authenticated"}', true);
SELECT results_eq(
  $$SELECT work_title, kind, photo_token, photo_alt FROM public.member_works_pictured_to_members('mbr_phVera000001') ORDER BY work_title$$,
  $$VALUES ('A Globe Fake Work'::text, 'the_end'::text, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1'::text, 'Me, at my desk'::text),
           ('A House Fake Work'::text, 'the_end'::text, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2'::text, 'House alt'::text),
           ('Vera Fake Book'::text, 'published'::text, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa4'::text, 'Holding my book'::text)$$,
  'another member sees the photo of each step at the house and the globe, and the Published photo, and nothing of the lock');
SELECT is(
  (SELECT count(*)::int FROM public.member_works_pictured_to_members('mbr_phVera000001') t WHERE row_to_json(t)::text ~ '(A Lock Fake Work|Lock alt|aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa3|mbr_phVera000001/|mlst_|book_)'),
  0, 'a private milestone and its photo are not returned, and no id or storage path ever is');
RESET ROLE;

-- An admin who calls the member reader gets the same: nothing private, whoever calls.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-0000000fb1a3", "email": "ph-admin@example.test", "role": "authenticated"}', true);
SELECT is(
  (SELECT count(*)::int FROM public.member_works_pictured_to_members('mbr_phVera000001') t WHERE row_to_json(t)::text ~ '(A Lock Fake Work|Lock alt|aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa3)'),
  0, 'an admin gets no private photo from the reader either');
RESET ROLE;

-- The web reader: service role only, the globe and Published.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-0000000fb1a2", "email": "ph-wade@example.test", "role": "authenticated"}', true);
SELECT throws_ok($$SELECT * FROM public.member_works_pictured_on_web('mbr_phVera000001')$$, '42501', NULL, 'a signed-in member cannot call the web reader');
SELECT throws_ok($$SELECT * FROM public.member_works_pictured('mbr_phVera000001', ARRAY['private', 'community', 'public'])$$, '42501', NULL, 'nor the shared body, which would return the lock');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT * FROM public.member_works_pictured_to_members('mbr_phVera000001')$$, '42501', NULL, 'a visitor with no sign-in cannot call the member reader');
SELECT throws_ok($$SELECT * FROM public.member_works_pictured_on_web('mbr_phVera000001')$$, '42501', NULL, 'nor the web reader');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role": "service_role"}', true);
SELECT results_eq(
  $$SELECT work_title, photo_token FROM public.member_works_pictured_on_web('mbr_phVera000001') ORDER BY work_title$$,
  $$VALUES ('A Globe Fake Work'::text, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1'::text),
           ('Vera Fake Book'::text, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa4'::text)$$,
  'the web reader returns the globe photo and the Published photo, not the house or lock ones');
RESET ROLE;

-- A taken-back milestone and a deleted book return nothing.
UPDATE public.member_milestones SET deleted_at = now() WHERE id = 'mlst_phGlobe0001';
UPDATE public.member_books SET deleted_at = now() WHERE id = 'book_phVera00001';
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role": "service_role"}', true);
SELECT is((SELECT count(*)::int FROM public.member_works_pictured_on_web('mbr_phVera000001')), 0, 'a taken-back milestone and a book removed from the Bookshelf come with no photo');
RESET ROLE;

-- A removal request deletes the photo rows with the member.
SELECT is((SELECT action FROM public.member_data_handling WHERE table_name = 'member_book_photos' AND column_name = 'member_id'), 'delete', 'a removal request deletes book photos');
SELECT is((SELECT action FROM public.member_data_handling WHERE table_name = 'member_milestones' AND column_name = 'member_id'), 'delete', 'and the milestones with their photo paths');
SELECT * FROM finish(true);
ROLLBACK;
