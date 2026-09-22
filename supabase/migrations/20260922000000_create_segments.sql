-- Segments (Local Layer)
-- Static, manually-curated groups of members (e.g. "founding hedgies") used to
-- target bulk invites and feature-flag rollouts. Membership is a flat list of
-- member_ids pasted in by an admin — no dynamic/rule-based computation yet.

CREATE TABLE IF NOT EXISTS segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

CREATE TABLE IF NOT EXISTS segment_members (
  segment_id UUID NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (segment_id, member_id)
);

-- Index for reverse lookups: "which segments is this member in" (used by
-- feature-flag evaluation on every page load for the logged-in member).
CREATE INDEX idx_segment_members_member_id ON segment_members(member_id);

-- RLS: mirrors the permissive pattern used by other Local-layer tables
-- (e.g. member_status_overrides) — actual admin-only mutation is enforced at
-- the API route layer via requireAdmin, while reads must stay open to any
-- authenticated user because feature-flag evaluation checks segment
-- membership for the current member on every page load.
ALTER TABLE segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE segment_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read segments"
  ON segments FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated insert segments"
  ON segments FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow authenticated update segments"
  ON segments FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated delete segments"
  ON segments FOR DELETE
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated read segment_members"
  ON segment_members FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated insert segment_members"
  ON segment_members FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow authenticated delete segment_members"
  ON segment_members FOR DELETE
  TO authenticated
  USING (true);

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON segments TO authenticated;
GRANT SELECT, INSERT, DELETE ON segment_members TO authenticated;
GRANT ALL ON segments TO service_role;
GRANT ALL ON segment_members TO service_role;

COMMENT ON TABLE segments IS 'LOCAL: Static, manually-curated groups of members (e.g. founding hedgies) used to target invites and feature-flag rollouts';
COMMENT ON TABLE segment_members IS 'LOCAL: Membership of a member in a segment — manually curated by admins, not dynamically computed';
