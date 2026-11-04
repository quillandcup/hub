-- Step one of retiring member_books.format, purchase_url and price, which `editions` replaced
-- (20270501000000). The app stops reading and writing them in the same deploy, so purchase_url needs
-- a default for then: a new book no longer sets it. Nothing is dropped here; that is the next
-- migration, once this deploy is live.
set lock_timeout = '5s';

-- A book the previous deploy's code saved without editions (it wrote only the old columns) keeps its
-- one edition. Idempotent: books that already have editions are left alone.
UPDATE public.member_books
   SET editions = jsonb_build_array(jsonb_build_object('format', format, 'purchase_url', purchase_url, 'price', price))
 WHERE editions = '[]'::jsonb AND purchase_url IS NOT NULL AND btrim(purchase_url) <> '';

ALTER TABLE public.member_books ALTER COLUMN purchase_url SET DEFAULT '';

NOTIFY pgrst, 'reload schema';
