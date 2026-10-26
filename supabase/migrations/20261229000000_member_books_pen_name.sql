-- The pen name a book is published under. Null means the member's display name (or legal name when
-- they have none), so every existing book keeps showing as it does today. The app only accepts the
-- member's display name or one of their own active name aliases (lib/book-pen-name.ts).
ALTER TABLE public.member_books ADD COLUMN pen_name text;

COMMENT ON COLUMN public.member_books.pen_name IS 'Name the book is published under; null = the member''s display name.';
