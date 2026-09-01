-- Adds shop-catalog fields to member_books so the Bookshelf can carry the price and
-- format members' books are actually sold in, plus an optional genre. Added ahead of a
-- one-time backfill from the live Shopify-powered storefront at /hedgie-books.
--
-- format defaults to 'print' because the storefront doesn't expose a print/ebook
-- distinction -- most listed books are print, and unknown cases should not be left blank.

ALTER TABLE member_books
  ADD COLUMN price NUMERIC(10, 2),
  ADD COLUMN genre TEXT,
  ADD COLUMN format TEXT NOT NULL DEFAULT 'print';

ALTER TABLE member_books
  ADD CONSTRAINT member_books_format_check CHECK (format IN ('print', 'ebook'));

COMMENT ON COLUMN member_books.price IS 'Sale price in USD, if known.';
COMMENT ON COLUMN member_books.genre IS 'Free-text genre; not scraped from the storefront, curated manually.';
COMMENT ON COLUMN member_books.format IS 'print or ebook; defaults to print when the format is not known.';
