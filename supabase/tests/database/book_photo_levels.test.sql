-- pgTAP tests for 20271122100000_book_photos_follow_book_level.sql: the photo of the member holding their book has the book's own level.
--   * the picture readers list Published, and return its photo, only for a book at a level they serve: members get the house and the globe,
--     the web gets the globe, nobody gets the lock;
--   * a hidden book does not lend its title to a work, so a photo's work name does not leak either;
--   * a book moved down loses the photo at once for the readers it no longer serves, and back up gets it again;
--   * the shared body and the readers keep their grants.
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(14);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000fc01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bp-quinn@example.test');
INSERT INTO public.user_profiles (id, email) VALUES ('00000000-0000-4000-a000-00000000fc01', 'bp-quinn@example.test') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('mbr_bpQuinn00001', 'Quinn Photo', 'bp-quinn@example.test', now(), 'active', '00000000-0000-4000-a000-00000000fc01'),
  ('mbr_bpPia000001a', 'Pia Photo', 'bp-pia@example.test', now(), 'active', NULL);
INSERT INTO public.member_books (id, member_id, title, cover_url, published_date, visibility) VALUES
  ('book_bpLock0001a', 'mbr_bpPia000001a', 'Pia Lock Fake Book', 'https://example.test/c.png', '2026-01-01', 'private'),
  ('book_bpHouse001a', 'mbr_bpPia000001a', 'Pia House Fake Book', 'https://example.test/c.png', '2026-02-01', 'community'),
  ('book_bpGlobe001a', 'mbr_bpPia000001a', 'Pia Globe Fake Book', 'https://example.test/c.png', '2026-03-01', 'public');
INSERT INTO public.member_book_photos (book_id, member_id, photo_path, photo_alt) VALUES
  ('book_bpLock0001a', 'mbr_bpPia000001a', 'mbr_bpPia000001a/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb1.webp', 'Lock photo alt'),
  ('book_bpHouse001a', 'mbr_bpPia000001a', 'mbr_bpPia000001a/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2.webp', 'House photo alt'),
  ('book_bpGlobe001a', 'mbr_bpPia000001a', 'mbr_bpPia000001a/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb3.webp', 'Globe photo alt');

-- Another member: the house and the globe, never the lock.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000fc01", "email": "bp-quinn@example.test", "role": "authenticated"}', true);
SELECT results_eq(
  $$SELECT work_title, visibility, photo_token FROM public.member_works_pictured_to_members('mbr_bpPia000001a') ORDER BY work_title$$,
  $$VALUES ('Pia Globe Fake Book'::text, 'public'::text, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb3'::text), ('Pia House Fake Book'::text, 'community'::text, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2'::text)$$,
  'members get the photo of a book at the house and at the globe, at the book''s level');
SELECT is(
  (SELECT count(*)::int FROM public.member_works_pictured_to_members('mbr_bpPia000001a') t WHERE row_to_json(t)::text ~ '(Lock Fake|Lock photo|bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb1|book_|mbr_bpPia)'),
  0, 'and nothing of the book at the lock: no title, no photo, no description, no id');
RESET ROLE;

-- The web: the globe only.
SET LOCAL ROLE service_role;
SELECT results_eq(
  $$SELECT work_title, photo_token FROM public.member_works_pictured_on_web('mbr_bpPia000001a') ORDER BY work_title$$,
  $$VALUES ('Pia Globe Fake Book'::text, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb3'::text)$$,
  'the web gets the photo of a book at the globe only');
SELECT is(
  (SELECT count(*)::int FROM public.member_works_pictured_on_web('mbr_bpPia000001a') t WHERE row_to_json(t)::text ~ '(Lock|House|bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb[12])'),
  0, 'and nothing of the book at the house or at the lock');
RESET ROLE;

-- A milestone on a hidden book is named by what the viewer may see, never by the book.
INSERT INTO public.member_milestones (id, member_id, kind, source, status, confirmed_at, book_id, visibility) VALUES
  ('mlst_bpLock0001', 'mbr_bpPia000001a', 'the_end', 'member', 'confirmed', now(), 'book_bpLock0001a', 'public'),
  ('mlst_bpHouse001', 'mbr_bpPia000001a', 'the_end', 'member', 'confirmed', now(), 'book_bpHouse001a', 'public');
SET LOCAL ROLE service_role;
SELECT is((SELECT count(*)::int FROM public.member_works_pictured_on_web('mbr_bpPia000001a') WHERE work_title ~ 'Lock|House'), 0, 'a milestone on a book at the lock or the house gets no title from the book on the web');
SELECT is((SELECT count(*)::int FROM public.member_works_pictured_to_members('mbr_bpPia000001a') WHERE work_title ~ 'Lock'), 0, 'nor for members, for the lock');
SELECT is((SELECT count(*)::int FROM public.member_works_pictured_to_members('mbr_bpPia000001a') WHERE kind = 'the_end' AND work_title = 'Pia House Fake Book'), 1, 'but the house book names its own milestone for members');
RESET ROLE;

-- Moving a book down takes its photo away at once; moving it back brings it back.
UPDATE public.member_books SET visibility = 'private' WHERE id = 'book_bpGlobe001a';
SET LOCAL ROLE service_role;
SELECT is((SELECT count(*)::int FROM public.member_works_pictured_on_web('mbr_bpPia000001a') WHERE photo_token IS NOT NULL), 0, 'a globe book made private is gone from the web, photo included');
SELECT is((SELECT count(*)::int FROM public.member_works_pictured_to_members('mbr_bpPia000001a') WHERE photo_token = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb3'), 0, 'and from members');
RESET ROLE;
UPDATE public.member_books SET visibility = 'community' WHERE id = 'book_bpGlobe001a';
SET LOCAL ROLE service_role;
SELECT is((SELECT count(*)::int FROM public.member_works_pictured_to_members('mbr_bpPia000001a') WHERE photo_token = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb3'), 1, 'moved to the house it is there for members again');
SELECT is((SELECT count(*)::int FROM public.member_works_pictured_on_web('mbr_bpPia000001a') WHERE photo_token = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb3'), 0, 'but not on the web');
RESET ROLE;

-- Grants and the pinned search path are as they were.
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT * FROM public.member_works_pictured_to_members('mbr_bpPia000001a')$$, '42501', NULL, 'a visitor cannot call the member reader');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000fc01", "email": "bp-quinn@example.test", "role": "authenticated"}', true);
SELECT throws_ok($$SELECT * FROM public.member_works_pictured('mbr_bpPia000001a', ARRAY['private', 'community', 'public'])$$, '42501', NULL, 'a member cannot call the shared body, which would return the lock');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname = 'member_works_pictured' AND pronamespace = 'public'::regnamespace AND prosecdef AND proconfig @> ARRAY['search_path=""']), 1, 'the shared body is SECURITY DEFINER with an empty search path');

SELECT * FROM finish(true);
ROLLBACK;
