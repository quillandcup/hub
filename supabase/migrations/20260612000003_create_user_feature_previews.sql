-- User Feature Previews (Local Layer)
-- Tracks which feature previews each admin user has opted into
-- Presence of a row means the feature is enabled for that user

CREATE TABLE IF NOT EXISTS user_feature_previews (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  enabled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, feature_key)
);

-- Index for lookups by user
CREATE INDEX idx_user_feature_previews_user_id ON user_feature_previews(user_id);

-- RLS: users can only manage their own feature previews
ALTER TABLE user_feature_previews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own feature previews"
  ON user_feature_previews FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own feature previews"
  ON user_feature_previews FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own feature previews"
  ON user_feature_previews FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Grants
GRANT SELECT, INSERT, DELETE ON user_feature_previews TO authenticated;
GRANT ALL ON user_feature_previews TO service_role;

COMMENT ON TABLE user_feature_previews IS 'LOCAL: Admin self-selected feature preview opt-ins — presence of row means feature is enabled for that user';
