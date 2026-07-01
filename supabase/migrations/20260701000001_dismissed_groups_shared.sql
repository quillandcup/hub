-- Replace per-user dismissed_duplicate_groups with a shared table.
-- Any admin dismissal is visible to all admins — no need for each admin to re-review.

DROP TABLE IF EXISTS dismissed_duplicate_groups;

CREATE TABLE dismissed_duplicate_groups (
  group_key TEXT PRIMARY KEY,
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE dismissed_duplicate_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read dismissed groups"
  ON dismissed_duplicate_groups FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can dismiss groups"
  ON dismissed_duplicate_groups FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Admins can undismiss groups"
  ON dismissed_duplicate_groups FOR DELETE
  TO authenticated
  USING (true);

GRANT SELECT, INSERT, DELETE ON dismissed_duplicate_groups TO authenticated;
GRANT ALL ON dismissed_duplicate_groups TO service_role;

COMMENT ON TABLE dismissed_duplicate_groups IS 'LOCAL: Shared admin dismissals on the Merge & Fix page — group_key is sorted member IDs joined by "|"';
