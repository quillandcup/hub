-- pgTAP tests for 20271122000000_member_books_visibility.sql (docs/product/WRITER_PROFILES.md, "The public Hedgie Bookshelf"):
--   * the column: private, community or public, not null, public by default (a book already on the Bookshelf was on a public list);
--   * who reads a book through the table: another member sees live books that are not private, the owner sees every one of theirs,
--     an admin keeps the access an admin has, a visitor sees none;
--   * a private book's cover is not a "book cover everyone can read", a community or public one is;
--   * the profile strips (member_works_dated_to_members and _on_web) name a work by a book's title and list its Published step only
--     when the book's own level is one the reader serves: members get community and public, the web gets public only; a private
--     book neither adds a step nor lends its title to a milestone, whoever asks;
--   * the feature flag of the one-time heads-up exists and is off.
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(29);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000fb01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bv-quinn@example.test'),
  ('00000000-0000-4000-a000-00000000fb02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bv-pia@example.test'),
  ('00000000-0000-4000-a000-00000000fb03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bv-dana@example.test');
INSERT INTO public.user_profiles (id, email) VALUES
  ('00000000-0000-4000-a000-00000000fb01', 'bv-quinn@example.test'),
  ('00000000-0000-4000-a000-00000000fb02', 'bv-pia@example.test'),
  ('00000000-0000-4000-a000-00000000fb03', 'bv-dana@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-4000-a000-00000000fb03', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;
INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('mbr_bvQuinn00001', 'Quinn Shelf', 'bv-quinn@example.test', now(), 'active', '00000000-0000-4000-a000-00000000fb01'),
  ('mbr_bvPia000001a', 'Pia Shelf', 'bv-pia@example.test', now(), 'active', '00000000-0000-4000-a000-00000000fb02'),
  ('mbr_bvDana00001a', 'Dana Shelf', 'bv-dana@example.test', now(), 'active', '00000000-0000-4000-a000-00000000fb03');

-- The column.
SELECT col_not_null('public', 'member_books', 'visibility', 'visibility is not null');
SELECT col_default_is('public', 'member_books', 'visibility', 'public', 'and a book starts at the globe');
SELECT throws_ok(
  $$INSERT INTO public.member_books (id, member_id, title, cover_url, published_date, visibility) VALUES ('book_bvBad000001', 'mbr_bvPia000001a', 'A Bad Fake Level', 'https://example.test/c.png', '2026-01-01', 'everyone')$$,
  '23514', NULL, 'a level that is not private, community or public is refused');

INSERT INTO public.media_assets (id, storage_path, mime_type, width, height, bytes, sha256, title, owner_member_id) VALUES
  ('media_bvPrivate01', 'originals/bv/private.png', 'image/png', 1, 1, 1, 'bv-private', 'bv private', 'mbr_bvPia000001a'),
  ('media_bvHouse001a', 'originals/bv/house.png', 'image/png', 1, 1, 1, 'bv-house', 'bv house', 'mbr_bvPia000001a'),
  ('media_bvGlobe001a', 'originals/bv/globe.png', 'image/png', 1, 1, 1, 'bv-globe', 'bv globe', 'mbr_bvPia000001a');
INSERT INTO public.member_books (id, member_id, title, cover_url, published_date, visibility, cover_asset_id) VALUES
  ('book_bvPrivate01', 'mbr_bvPia000001a', 'Pia Private Fake Book', 'https://example.test/c.png', '2026-01-01', 'private', 'media_bvPrivate01'),
  ('book_bvHouse001a', 'mbr_bvPia000001a', 'Pia House Fake Book', 'https://example.test/c.png', '2026-02-01', 'community', 'media_bvHouse001a'),
  ('book_bvGlobe001a', 'mbr_bvPia000001a', 'Pia Globe Fake Book', 'https://example.test/c.png', '2026-03-01', 'public', 'media_bvGlobe001a');
INSERT INTO public.member_books (id, member_id, title, cover_url, published_date) VALUES
  ('book_bvDefault01', 'mbr_bvPia000001a', 'Pia Default Fake Book', 'https://example.test/c.png', '2026-04-01');
INSERT INTO public.member_books (id, member_id, title, cover_url, published_date, deleted_at) VALUES
  ('book_bvGone0001a', 'mbr_bvPia000001a', 'Pia Deleted Fake Book', 'https://example.test/c.png', '2026-05-01', now());
SELECT is((SELECT visibility FROM public.member_books WHERE id = 'book_bvDefault01'), 'public', 'a book that names no level is at the globe');

-- Another member: live books that are not private.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000fb01", "email": "bv-quinn@example.test", "role": "authenticated"}', true);
SELECT results_eq(
  $$SELECT title FROM public.member_books WHERE member_id = 'mbr_bvPia000001a' ORDER BY published_date$$,
  $$VALUES ('Pia House Fake Book'::text), ('Pia Globe Fake Book'::text), ('Pia Default Fake Book'::text)$$,
  'another member reads a live book at the house or the globe, not a private or a deleted one');
SELECT is((SELECT count(*)::int FROM public.member_books WHERE id = 'book_bvPrivate01'), 0, 'a private book is not there by its id either');
SELECT is((SELECT count(*)::int FROM public.media_assets WHERE id = 'media_bvPrivate01'), 0, 'a private book''s cover is not readable by another member');
SELECT is((SELECT count(*)::int FROM public.media_assets WHERE id IN ('media_bvHouse001a', 'media_bvGlobe001a')), 2, 'but a house or globe book''s cover is');
UPDATE public.member_books SET visibility = 'private' WHERE id = 'book_bvGlobe001a';
RESET ROLE;
SELECT is((SELECT visibility FROM public.member_books WHERE id = 'book_bvGlobe001a'), 'public', 'another member cannot change a book''s level: it is still at the globe');

-- The owner sees every live one and changes the level.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000fb02", "email": "bv-pia@example.test", "role": "authenticated"}', true);
SELECT is((SELECT count(*)::int FROM public.member_books WHERE member_id = 'mbr_bvPia000001a' AND deleted_at IS NULL), 4, 'the owner reads all four live books, the private one too');
SELECT is((SELECT count(*)::int FROM public.media_assets WHERE id = 'media_bvPrivate01'), 1, 'and the cover of the private one');
UPDATE public.member_books SET visibility = 'private' WHERE id = 'book_bvDefault01';
SELECT is((SELECT visibility FROM public.member_books WHERE id = 'book_bvDefault01'), 'private', 'the owner can make a book private');
RESET ROLE;

-- An admin keeps the access an admin has to a member's own rows (sudo writes as the admin); the app asks for the member's view itself.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000fb03", "email": "bv-dana@example.test", "role": "authenticated"}', true);
SELECT is((SELECT count(*)::int FROM public.member_books WHERE member_id = 'mbr_bvPia000001a' AND deleted_at IS NULL), 4, 'an admin reads every live book, as for every other member-owned row');
RESET ROLE;

-- A visitor reads nothing.
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT count(*) FROM public.member_books$$, '42501', NULL, 'a visitor who is not signed in reads no book through the table');
RESET ROLE;

-- The profile strips. Pia: a project whose book is private, a milestone on it, and a loose book at each other level.
INSERT INTO public.writing_projects (id, member_id, title, phase, visibility) VALUES
  ('wprj_bvOpen0001a', 'mbr_bvPia000001a', 'Pia Open Fake Project', 'revising', 'public');
UPDATE public.member_books SET visibility = 'public', deleted_at = now() WHERE id = 'book_bvDefault01';
INSERT INTO public.member_books (id, member_id, title, cover_url, published_date, project_id, visibility) VALUES
  ('book_bvLinked001', 'mbr_bvPia000001a', 'Pia Linked Fake Book', 'https://example.test/c.png', '2026-06-01', 'wprj_bvOpen0001a', 'private');
INSERT INTO public.member_milestones (id, member_id, kind, source, status, confirmed_at, project_id, book_id, visibility) VALUES
  ('mlst_bvEnd00001', 'mbr_bvPia000001a', 'the_end', 'member', 'confirmed', now(), 'wprj_bvOpen0001a', 'book_bvLinked001', 'public');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000fb01", "email": "bv-quinn@example.test", "role": "authenticated"}', true);
SELECT results_eq(
  $$SELECT kind, work_title, visibility FROM public.member_works_dated_to_members('mbr_bvPia000001a') ORDER BY work_title, kind$$,
  $$VALUES ('published'::text, 'Pia Globe Fake Book'::text, 'public'::text), ('published'::text, 'Pia House Fake Book'::text, 'community'::text), ('the_end'::text, 'Pia Open Fake Project'::text, 'public'::text)$$,
  'members get Published for a book at the house or the globe, at its own level, and none for the private one');
SELECT is(
  (SELECT count(*)::int FROM public.member_works_dated_to_members('mbr_bvPia000001a') t WHERE row_to_json(t)::text ~ '(Private Fake Book|Linked Fake Book|book_|mlst_|wprj_)'),
  0, 'and no private book''s title or an id comes out in any row');
SELECT is((SELECT work_title FROM public.member_works_dated_to_members('mbr_bvPia000001a') WHERE kind = 'the_end'), 'Pia Open Fake Project', 'a milestone on a private book is named by its project, never by the book');
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT results_eq(
  $$SELECT kind, work_title FROM public.member_works_dated_on_web('mbr_bvPia000001a') ORDER BY work_title, kind$$,
  $$VALUES ('published'::text, 'Pia Globe Fake Book'::text), ('the_end'::text, 'Pia Open Fake Project'::text)$$,
  'the web gets Published only for a book at the globe');
SELECT is(
  (SELECT count(*)::int FROM public.member_works_dated_on_web('mbr_bvPia000001a') t WHERE row_to_json(t)::text ~ '(Private Fake Book|House Fake Book|Linked Fake Book|book_|mlst_|wprj_)'),
  0, 'and never the title of a book that is private or at the house, or an id');
RESET ROLE;

-- Raising a private book to the house or the globe brings the step (and its title) back, lowering it takes it away at once.
UPDATE public.member_books SET visibility = 'community' WHERE id = 'book_bvLinked001';
SET LOCAL ROLE service_role;
SELECT is((SELECT count(*)::int FROM public.member_works_dated_to_members('mbr_bvPia000001a') WHERE work_title = 'Pia Linked Fake Book' AND kind = 'published'), 1, 'a book moved to the house is Published for members');
SELECT is((SELECT count(*)::int FROM public.member_works_dated_on_web('mbr_bvPia000001a') WHERE work_title = 'Pia Linked Fake Book'), 0, 'but not on the web');
RESET ROLE;
UPDATE public.member_books SET visibility = 'public' WHERE id = 'book_bvLinked001';
SET LOCAL ROLE service_role;
SELECT is((SELECT count(*)::int FROM public.member_works_dated_on_web('mbr_bvPia000001a') WHERE kind = 'published' AND work_title = 'Pia Open Fake Project'), 0, 'the book of a project is named by what the viewer may see (the title of the book first)');
SELECT is((SELECT count(*)::int FROM public.member_works_dated_on_web('mbr_bvPia000001a') WHERE kind = 'published' AND work_title = 'Pia Linked Fake Book'), 1, 'a book moved to the globe is Published on the web');
RESET ROLE;
UPDATE public.member_books SET visibility = 'private' WHERE id = 'book_bvLinked001';
SET LOCAL ROLE service_role;
SELECT is((SELECT count(*)::int FROM public.member_works_dated_on_web('mbr_bvPia000001a') WHERE work_title = 'Pia Linked Fake Book'), 0, 'and made private again, it is gone from the web at once');
RESET ROLE;

-- The readers are still not open to everyone.
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT * FROM public.member_works_dated_to_members('mbr_bvPia000001a')$$, '42501', NULL, 'a visitor cannot call the member reader');
SELECT throws_ok($$SELECT * FROM public.member_works_dated('mbr_bvPia000001a', ARRAY['private', 'community', 'public'])$$, '42501', NULL, 'nor the shared body, which would give a private book');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000fb01", "email": "bv-quinn@example.test", "role": "authenticated"}', true);
SELECT throws_ok($$SELECT * FROM public.member_works_dated('mbr_bvPia000001a', ARRAY['private', 'community', 'public'])$$, '42501', NULL, 'a signed-in member cannot call the shared body either');
RESET ROLE;

-- The shared body still pins an empty search path, and the heads-up flag starts off.
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname = 'member_works_dated' AND pronamespace = 'public'::regnamespace AND prosecdef AND proconfig @> ARRAY['search_path=""']), 1, 'the shared body is SECURITY DEFINER with an empty search path');
SELECT is((SELECT enabled_globally FROM public.feature_flags WHERE feature_key = 'book_visibility_notice'), false, 'the one-time heads-up is off for everyone');

SELECT * FROM finish(true);
ROLLBACK;
