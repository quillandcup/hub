-- Members now upload a cover image file (validated server-side against the site's
-- established cover spec -- PNG/JPEG, 145x215px, see lib/bookCover.ts) instead of
-- pasting a URL to wherever it happens to be hosted. Also makes cover_url and
-- purchase_url required, matching the "Celebrating Your New Published Hedgie Book!"
-- Google Form this feature replaces (both fields are required there).
--
-- Public bucket: covers are shown on the public community Bookshelf page, so
-- reads need no auth. Writes are scoped to the uploading member's own folder,
-- same per-user-folder RLS shape as storage.objects for feedback-screenshots
-- (20260827130000_create_feedback_table.sql), minus the admin-can-view-all
-- clause since reads are public here.

INSERT INTO storage.buckets (id, name, public)
VALUES ('book-covers', 'book-covers', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Anyone can view book covers"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'book-covers');

CREATE POLICY "Members can upload their own book covers"
    ON storage.objects FOR INSERT
    WITH CHECK (
        bucket_id = 'book-covers'
        AND (
            (storage.foldername(name))[1] IN (SELECT id::text FROM members WHERE email = auth.email())
            OR is_admin()
        )
    );

CREATE POLICY "Members can replace or remove their own book covers"
    ON storage.objects FOR UPDATE
    USING (
        bucket_id = 'book-covers'
        AND (
            (storage.foldername(name))[1] IN (SELECT id::text FROM members WHERE email = auth.email())
            OR is_admin()
        )
    );

CREATE POLICY "Members can delete their own book covers"
    ON storage.objects FOR DELETE
    USING (
        bucket_id = 'book-covers'
        AND (
            (storage.foldername(name))[1] IN (SELECT id::text FROM members WHERE email = auth.email())
            OR is_admin()
        )
    );

ALTER TABLE member_books
  ALTER COLUMN cover_url SET NOT NULL,
  ALTER COLUMN purchase_url SET NOT NULL;
