-- Hedgie Bookshelf: a native record of books members have published. Backs the community
-- "Bookshelf" page (app/(member)/bookshelf) and lets the Published Author badge be computed
-- automatically (see lib/badges.ts) instead of manually awarded.
--
-- LOCAL layer: member-owned, self-reported data, same pattern as writing_projects (see
-- CLAUDE.md and 20260828180000_create_writing_projects.sql). Not reprocessed.

CREATE TABLE member_books (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  cover_url TEXT,
  purchase_url TEXT,
  published_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_member_books_member_id ON member_books(member_id);
CREATE INDEX idx_member_books_published_date ON member_books(published_date);

COMMENT ON TABLE member_books IS
  'LOCAL: a book a member has published, shown on the community Bookshelf and counted for the automatic Published Author badge. Not reprocessed.';

ALTER TABLE member_books ENABLE ROW LEVEL SECURITY;

-- Same "manage own, admins bypass for sudo" shape as writing_projects, plus an explicit
-- everyone-can-view policy underneath it -- unlike writing progress, the Bookshelf is a
-- community-facing page by design, so every authenticated member can read every book.
CREATE POLICY "Authenticated users can view member_books"
  ON member_books FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Members manage their own member_books"
  ON member_books FOR ALL
  USING (member_id IN (SELECT id FROM members WHERE email = auth.email()) OR is_admin())
  WITH CHECK (member_id IN (SELECT id FROM members WHERE email = auth.email()) OR is_admin());
