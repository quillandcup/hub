-- pgTAP tests for 20270501000000_member_books_editions.sql:
--   * a book can carry one edition per format (print, ebook), each with its own link and price;
--   * the database refuses a duplicate format, an unknown format, a blank link, a negative price and
--     editions that aren't a list of at most two;
--   * a book written the old way (no editions) is still accepted, because the code live during a
--     deploy still writes only format, purchase_url and price.
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched.
-- Run with `pnpm test:pgtap` (scripts/test-pgtap.sh; CI runs it in the test-db job).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(12);

INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('mbr_AAAAAAAAed11', 'Editions Author', 'editions-author@example.test', now(), 'active');

SELECT is(public.valid_book_editions('[]'), true, 'no editions is allowed (the app requires one)');
SELECT is(public.valid_book_editions('[{"format":"print","purchase_url":"https://example.test/p","price":14}, {"format":"ebook","purchase_url":"https://example.test/e","price":null}]'),
  true, 'one print and one ebook edition, the ebook without a price');
SELECT is(public.valid_book_editions('[{"format":"print","purchase_url":"https://example.test/p"}, {"format":"print","purchase_url":"https://example.test/q"}]'),
  false, 'two print editions are refused');
SELECT is(public.valid_book_editions('[{"format":"audio","purchase_url":"https://example.test/a"}]'), false, 'an unknown format is refused');
SELECT is(public.valid_book_editions('[{"format":"print","purchase_url":"  "}]'), false, 'a blank link is refused');
SELECT is(public.valid_book_editions('[{"format":"print","purchase_url":"https://example.test/p","price":-1}]'), false, 'a negative price is refused');
SELECT is(public.valid_book_editions('{"format":"print"}'), false, 'editions that are not a list are refused');

SELECT lives_ok(
  $$INSERT INTO public.member_books (id, member_id, title, cover_url, purchase_url, published_date, editions)
    VALUES ('book_AAAAAAAAed11', 'mbr_AAAAAAAAed11', 'Both editions', 'https://example.test/c.jpg', 'https://example.test/p', '2026-01-01',
      '[{"format":"print","purchase_url":"https://example.test/p","price":14},{"format":"ebook","purchase_url":"https://example.test/e","price":5}]')$$,
  'a book with a print and an ebook edition is saved');
SELECT throws_ok(
  $$INSERT INTO public.member_books (id, member_id, title, cover_url, purchase_url, published_date, editions)
    VALUES ('book_AAAAAAAAed12', 'mbr_AAAAAAAAed11', 'Two prints', 'https://example.test/c.jpg', 'https://example.test/p', '2026-01-01',
      '[{"format":"print","purchase_url":"https://example.test/p"},{"format":"print","purchase_url":"https://example.test/q"}]')$$,
  '23514', NULL, 'a book with two print editions is refused by the table');
SELECT lives_ok(
  $$INSERT INTO public.member_books (id, member_id, title, cover_url, purchase_url, published_date)
    VALUES ('book_AAAAAAAAed13', 'mbr_AAAAAAAAed11', 'Written the old way', 'https://example.test/c.jpg', 'https://example.test/p', '2026-01-01')$$,
  'a book written without editions (the code live during a deploy) is still accepted');
SELECT is((SELECT editions FROM public.member_books WHERE id = 'book_AAAAAAAAed13'), '[]'::jsonb, 'and has no editions stored, so the app reads its old columns');

SELECT * FROM finish(true);
ROLLBACK;
