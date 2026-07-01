-- Dismissed Duplicate Groups (Local Layer)
-- Tracks which duplicate member groups each admin has dismissed on the Merge & Fix page.
-- group_key is sorted member IDs joined by "|", matching the client-side groupKey() function.

CREATE TABLE IF NOT EXISTS dismissed_duplicate_groups (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  group_key TEXT NOT NULL,
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, group_key)
);

CREATE INDEX idx_dismissed_duplicate_groups_user_id ON dismissed_duplicate_groups(user_id);

ALTER TABLE dismissed_duplicate_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own dismissed groups"
  ON dismissed_duplicate_groups FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own dismissed groups"
  ON dismissed_duplicate_groups FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own dismissed groups"
  ON dismissed_duplicate_groups FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

GRANT SELECT, INSERT, DELETE ON dismissed_duplicate_groups TO authenticated;
GRANT ALL ON dismissed_duplicate_groups TO service_role;

COMMENT ON TABLE dismissed_duplicate_groups IS 'LOCAL: Per-admin dismissals on the Merge & Fix page — group_key is sorted member IDs joined by "|"';
