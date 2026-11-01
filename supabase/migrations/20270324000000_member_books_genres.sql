-- A book's genres as tags (text[]) instead of one free-text string, so the Book Shelf can filter
-- by genre and search can match it. The book form already edits them as chips; until now they
-- were saved comma-joined in member_books.genre.

-- Each genre: trimmed, 1-40 chars; at most 5; no case-insensitive duplicates. Mirrors lib/book-genres.ts.
CREATE OR REPLACE FUNCTION public.valid_book_genres(genres TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT cardinality(genres) <= 5
    AND NOT EXISTS (
      SELECT 1 FROM unnest(genres) AS g(genre)
      WHERE genre IS NULL OR genre <> btrim(genre) OR length(genre) NOT BETWEEN 1 AND 40
    )
    AND (SELECT count(DISTINCT lower(genre)) FROM unnest(genres) AS g(genre)) = cardinality(genres);
$$;

COMMENT ON FUNCTION public.valid_book_genres(TEXT[]) IS
  'CHECK helper for member_books.genres: at most 5 trimmed genres of 1-40 chars, no case-insensitive duplicates. Mirrors lib/book-genres.ts.';

-- The genres as one lowercase string, for ILIKE search and the generated column below.
-- array_to_string is only STABLE in general, but it is fixed for text elements, which is all this takes.
CREATE OR REPLACE FUNCTION public.book_genres_search_text(genres TEXT[])
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT lower(array_to_string(genres, ' '));
$$;

ALTER TABLE public.member_books ADD COLUMN genres TEXT[] NOT NULL DEFAULT '{}';

-- Split the old comma-joined text: trim, drop blanks, cut to 40 chars, drop case-insensitive
-- duplicates (first spelling wins), keep the member's order, keep the first 5.
CREATE FUNCTION public.tmp_split_book_genre(stored TEXT) RETURNS TEXT[]
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  result TEXT[] := '{}';
  part TEXT;
  genre TEXT;
BEGIN
  FOREACH part IN ARRAY string_to_array(stored, ',') LOOP
    genre := left(btrim(regexp_replace(part, '\s+', ' ', 'g')), 40);
    CONTINUE WHEN genre = '' OR lower(genre) = ANY (SELECT lower(g) FROM unnest(result) AS r(g));
    result := result || genre;
    EXIT WHEN cardinality(result) = 5;
  END LOOP;
  RETURN result;
END;
$$;

UPDATE public.member_books SET genres = public.tmp_split_book_genre(genre) WHERE genre IS NOT NULL;
DROP FUNCTION public.tmp_split_book_genre(TEXT);

ALTER TABLE public.member_books
  ADD CONSTRAINT member_books_genres_valid CHECK (public.valid_book_genres(genres)),
  ADD COLUMN genres_search TEXT GENERATED ALWAYS AS (public.book_genres_search_text(genres)) STORED;

ALTER TABLE public.member_books DROP COLUMN genre;

COMMENT ON COLUMN public.member_books.genres IS
  'Genre tags the member chose, in their order (at most 5, see valid_book_genres). Curated by the member, not scraped from the storefront.';
COMMENT ON COLUMN public.member_books.genres_search IS
  'Generated: genres as one lowercase string, so search can ILIKE it. Never written.';

NOTIFY pgrst, 'reload schema';
