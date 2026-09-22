-- Feature Flags Registry (Local Layer)
-- Replaces the previous implicit "just a string, no registry" pattern for
-- feature keys with a real row per known flag, plus a global on/off switch
-- and segment-targeted rollout support.
--
-- A flag is effectively enabled for a user if ANY of:
--   1. feature_flags.enabled_globally is true for that key
--   2. a user_feature_previews row exists for that user+key (per-user opt-in,
--      unchanged from before)
--   3. the user's member is in a segment linked to that key via
--      feature_flag_segments

CREATE TABLE IF NOT EXISTS feature_flags (
  feature_key TEXT PRIMARY KEY,
  enabled_globally BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER update_feature_flags_updated_at
  BEFORE UPDATE ON feature_flags
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS feature_flag_segments (
  feature_key TEXT NOT NULL REFERENCES feature_flags(feature_key) ON DELETE CASCADE,
  segment_id UUID NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (feature_key, segment_id)
);

CREATE INDEX idx_feature_flag_segments_segment_id ON feature_flag_segments(segment_id);

-- Backfill the one flag key that predates this registry so it has a row
-- (defaulting to off — it was previously only ever granted per-user).
INSERT INTO feature_flags (feature_key, enabled_globally)
VALUES ('wheel_of_wonder', false)
ON CONFLICT (feature_key) DO NOTHING;

-- RLS: same permissive pattern as segments — reads must stay open to any
-- authenticated user because every page load evaluates flags for the
-- current user, and admin-only mutation is enforced at the API route layer.
ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_flag_segments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read feature_flags"
  ON feature_flags FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated insert feature_flags"
  ON feature_flags FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow authenticated update feature_flags"
  ON feature_flags FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated delete feature_flags"
  ON feature_flags FOR DELETE
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated read feature_flag_segments"
  ON feature_flag_segments FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated insert feature_flag_segments"
  ON feature_flag_segments FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow authenticated delete feature_flag_segments"
  ON feature_flag_segments FOR DELETE
  TO authenticated
  USING (true);

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON feature_flags TO authenticated;
GRANT SELECT, INSERT, DELETE ON feature_flag_segments TO authenticated;
GRANT ALL ON feature_flags TO service_role;
GRANT ALL ON feature_flag_segments TO service_role;

COMMENT ON TABLE feature_flags IS 'LOCAL: Registry of known feature flag keys plus a global on/off switch for each';
COMMENT ON TABLE feature_flag_segments IS 'LOCAL: Links a feature flag to a segment for targeted rollout to that segment''s members';
