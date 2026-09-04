-- Lets members add a cover image and description to a writing_projects row before it's
-- published (previously cover/description only existed on member_books, set at publish time),
-- and record a per-measure "starting balance" -- how much they already had before they started
-- tracking with this tool, so totals reflect the whole work, not just what's logged here.

ALTER TABLE writing_projects
  ADD COLUMN cover_url TEXT,
  ADD COLUMN description TEXT;

-- LOCAL layer, same pattern as writing_progress_entries (20260828180000_create_writing_projects.sql):
-- member_id is denormalized from writing_projects.member_id so RLS doesn't need a join, and so a
-- project can never be reassigned to another member's starting balances. 'prickles' is excluded
-- from the measure CHECK, matching writing_progress_entries.measure -- prickles is always computed
-- live from prickle_attendance (see lib/writing-projects.ts), never manually logged or carried over.
CREATE TABLE writing_project_starting_balances (
  project_id UUID NOT NULL REFERENCES writing_projects(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  measure TEXT NOT NULL CHECK (measure IN ('words', 'time_minutes', 'pages', 'chapters', 'scenes', 'lines')),
  amount NUMERIC NOT NULL CHECK (amount >= 0),
  PRIMARY KEY (project_id, measure)
);

CREATE INDEX idx_writing_project_starting_balances_member_id ON writing_project_starting_balances(member_id);

COMMENT ON TABLE writing_project_starting_balances IS
  'LOCAL: per-measure starting balance a member had before tracking a project here. Not reprocessed.';

ALTER TABLE writing_project_starting_balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members manage their own writing_project_starting_balances"
  ON writing_project_starting_balances FOR ALL
  USING (member_id IN (SELECT id FROM members WHERE email = auth.email()) OR is_admin())
  WITH CHECK (member_id IN (SELECT id FROM members WHERE email = auth.email()) OR is_admin());
