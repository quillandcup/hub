-- pgTAP test for member_books.genres (20270324000000_member_books_genres.sql): the CHECK helper
-- and the search text. Rolled back, so it leaves the shared local DB untouched.
-- Run with `pnpm test:pgtap`; finish(true) raises on any "not ok".
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(11);

SELECT ok(public.valid_book_genres('{}'), 'no genres is valid');
SELECT ok(public.valid_book_genres(ARRAY['Romance', 'Cozy Mystery']), 'a few trimmed genres are valid');
SELECT ok(public.valid_book_genres(ARRAY['a', 'b', 'c', 'd', 'e']), 'five genres are valid');
SELECT ok(NOT public.valid_book_genres(ARRAY['a', 'b', 'c', 'd', 'e', 'f']), 'six genres are not');
SELECT ok(NOT public.valid_book_genres(ARRAY['Fantasy', 'fantasy']), 'case-insensitive duplicates are not');
SELECT ok(NOT public.valid_book_genres(ARRAY[' Fantasy']), 'untrimmed genres are not');
SELECT ok(NOT public.valid_book_genres(ARRAY['']), 'an empty genre is not');
SELECT ok(NOT public.valid_book_genres(ARRAY[repeat('x', 41)]), 'a genre over 40 characters is not');
SELECT ok(public.valid_book_genres(ARRAY[repeat('x', 40)]), 'a genre of exactly 40 characters is');

SELECT is(public.book_genres_search_text(ARRAY['Cozy Mystery', 'ROMANCE']), 'cozy mystery romance', 'search text is the genres, lowercase');

SELECT is(
  (SELECT count(*)::int FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'member_books' AND column_name = 'genre'),
  0,
  'the old free-text genre column is gone'
);

SELECT * FROM finish(true);
ROLLBACK;
