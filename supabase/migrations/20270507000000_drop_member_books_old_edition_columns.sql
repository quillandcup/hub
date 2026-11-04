-- Second of two steps to retire member_books.format, purchase_url and price (expand, then contract; see
-- CLAUDE.md, "Migrations: expand, then contract"). `editions` replaced them (20270501000000, #967), and the
-- first step, #988, stopped the app from reading or writing them and is deployed (the production tag holds
-- it, and every live book already had editions). No function, policy or view references them. Dropping
-- `format` also drops its CHECK, member_books_format_check.

set lock_timeout = '5s';

-- Approved ban-drop-column ignore: the last read and write was removed in #988, which is deployed.
-- squawk-ignore ban-drop-column
ALTER TABLE public.member_books DROP COLUMN format;

-- Approved ban-drop-column ignore: the last read and write was removed in #988, which is deployed.
-- squawk-ignore ban-drop-column
ALTER TABLE public.member_books DROP COLUMN purchase_url;

-- Approved ban-drop-column ignore: the last read and write was removed in #988, which is deployed.
-- squawk-ignore ban-drop-column
ALTER TABLE public.member_books DROP COLUMN price;

COMMENT ON COLUMN public.member_books.editions IS
  'Where to buy the book, one entry per format: [{"format": "print"|"ebook", "purchase_url": text, "price": number|null}], at most one per format (see valid_book_editions).';

NOTIFY pgrst, 'reload schema';
