-- pgTAP test for 20270505000000_member_books_stop_using_old_edition_columns.sql: a book is saved
-- without the old purchase_url column (the app no longer sets it), and its editions carry the link.
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched.
-- Run with `pnpm test:pgtap` (scripts/test-pgtap.sh; CI runs it in the test-db job).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(2);

INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('mbr_AAAAAAAAed21', 'Default Author', 'default-author@example.test', now(), 'active');

SELECT lives_ok(
  $$INSERT INTO public.member_books (id, member_id, title, cover_url, published_date, editions)
    VALUES ('book_AAAAAAAAed21', 'mbr_AAAAAAAAed21', 'No old link', 'https://example.test/c.jpg', '2026-01-01',
      '[{"format":"print","purchase_url":"https://example.test/p","price":null}]')$$,
  'a book can be saved without the old purchase_url column');
SELECT is((SELECT purchase_url FROM public.member_books WHERE id = 'book_AAAAAAAAed21'), '', 'the old column takes its default, and the editions carry the link');

SELECT * FROM finish(true);
ROLLBACK;
