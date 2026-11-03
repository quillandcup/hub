-- One book, one card, up to one edition per format. Until now a book had a single format, link and
-- price, so a member with a print and an ebook edition had to add the book twice. The editions
-- ([{format, purchase_url, price}]) now live on the book itself: one row saves atomically, and the
-- row's RLS, soft delete and audit trail cover them.
--
-- Expand step only. The old columns (format, purchase_url, price) stay, and the app keeps writing the
-- first edition into them, because the code live in production while this deploys still reads them.
-- A later migration drops them, once nothing reads them any more. A book written by that old code in
-- the meantime has no editions; the app reads its old columns instead (lib/data/books.ts).
set lock_timeout = '5s';

-- Each edition: a format (print or ebook) at most once, a non-empty link, a price that is null or
-- not negative. Empty is allowed (see above); the app requires at least one. Mirrors
-- lib/book-editions.ts.
CREATE OR REPLACE FUNCTION public.valid_book_editions(editions JSONB)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT jsonb_typeof(editions) = 'array'
    AND jsonb_array_length(editions) <= 2
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(editions) AS e(edition)
      WHERE jsonb_typeof(e.edition) IS DISTINCT FROM 'object'
        OR e.edition ->> 'format' IS NULL OR e.edition ->> 'format' NOT IN ('print', 'ebook')
        OR jsonb_typeof(e.edition -> 'purchase_url') IS DISTINCT FROM 'string'
        OR btrim(e.edition ->> 'purchase_url') = ''
        OR NOT (e.edition -> 'price' IS NULL OR jsonb_typeof(e.edition -> 'price') = 'null'
                OR (jsonb_typeof(e.edition -> 'price') = 'number' AND (e.edition ->> 'price')::numeric >= 0))
    )
    AND (SELECT count(DISTINCT e.edition ->> 'format') FROM jsonb_array_elements(editions) AS e(edition))
        = jsonb_array_length(editions);
$$;

COMMENT ON FUNCTION public.valid_book_editions(JSONB) IS
  'CHECK helper for member_books.editions: at most one edition per format (print, ebook), each with a link and a price that is null or not negative. Mirrors lib/book-editions.ts.';

ALTER TABLE public.member_books ADD COLUMN editions JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Every existing book becomes one edition, from the format, link and price it has today.
UPDATE public.member_books
   SET editions = jsonb_build_array(jsonb_build_object('format', format, 'purchase_url', purchase_url, 'price', price));

ALTER TABLE public.member_books
  ADD CONSTRAINT member_books_editions_valid CHECK (public.valid_book_editions(editions));

COMMENT ON COLUMN public.member_books.editions IS
  'Where to buy the book, one entry per format: [{"format": "print"|"ebook", "purchase_url": text, "price": number|null}], at most one per format (see valid_book_editions). Replaces format, purchase_url and price, which stay until the app stops reading them.';

NOTIFY pgrst, 'reload schema';
