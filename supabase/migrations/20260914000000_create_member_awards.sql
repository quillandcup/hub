-- Member-reported external award/competition wins (e.g. IPPY Awards, RWA Vivian Award, a
-- themed anthology contest). Members currently share these informally in the
-- #hedgie-classifieds Slack channel, with no structured tracking -- staff want to know about a
-- win both to celebrate it and to use in Quill & Cup's own marketing/stats.
--
-- This is Phase 1 from docs/TODO.md's "Awards & Competition Tracking": just recording wins, the
-- same self-report shape as member_books (20260831120000_create_member_books.sql). Submission
-- tracking / win-rate stats (Phase 2) and an internal award-deadline list (Phase 3) are explicitly
-- deferred, not built here.
--
-- LOCAL layer: member-owned, self-reported data, same pattern as member_books/writing_projects.
-- Not reprocessed.

CREATE TABLE member_awards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  award_name TEXT NOT NULL,
  category TEXT,
  -- The piece that won -- a short story, poem, or full manuscript. Free text so a win isn't
  -- blocked on the work already being tracked as a member_books/writing_projects row; book_id /
  -- project_id below are an optional cross-reference when it is.
  work_title TEXT NOT NULL,
  book_id UUID REFERENCES member_books(id) ON DELETE SET NULL,
  project_id UUID REFERENCES writing_projects(id) ON DELETE SET NULL,
  award_date DATE NOT NULL,
  url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_member_awards_member_id ON member_awards(member_id);
CREATE INDEX idx_member_awards_book_id ON member_awards(book_id);
CREATE INDEX idx_member_awards_project_id ON member_awards(project_id);

COMMENT ON TABLE member_awards IS
  'LOCAL: an external award/competition win a member self-reports, optionally linked to one of their member_books or writing_projects rows. Not reprocessed.';

ALTER TABLE member_awards ENABLE ROW LEVEL SECURITY;

-- Same "manage own, admins bypass for sudo, everyone can view" shape as member_books.
CREATE POLICY "Authenticated users can view member_awards"
  ON member_awards FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Members manage their own member_awards"
  ON member_awards FOR ALL
  USING (member_id IN (SELECT id FROM members WHERE email = auth.email()) OR is_admin())
  WITH CHECK (member_id IN (SELECT id FROM members WHERE email = auth.email()) OR is_admin());
