-- Member Status Overrides (Local Layer)
-- Tracks special cases where member status differs from default rules
-- Examples: hiatus, gifts (180 program, hosting, compensation), special cases

CREATE TABLE IF NOT EXISTS member_status_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID REFERENCES members(id) ON DELETE CASCADE,
  override_type TEXT NOT NULL CHECK (override_type IN ('hiatus', 'gift', 'special')),
  reason TEXT NOT NULL,
  notes TEXT,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_member_status_overrides_member_id ON member_status_overrides(member_id);
CREATE INDEX idx_member_status_overrides_type ON member_status_overrides(override_type);

-- Updated_at trigger
CREATE TRIGGER update_member_status_overrides_updated_at
  BEFORE UPDATE ON member_status_overrides
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- RLS policies
ALTER TABLE member_status_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated users to read member status overrides"
  ON member_status_overrides FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated users to insert member status overrides"
  ON member_status_overrides FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow authenticated users to update member status overrides"
  ON member_status_overrides FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated users to delete member status overrides"
  ON member_status_overrides FOR DELETE
  TO authenticated
  USING (true);

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON member_status_overrides TO authenticated;
GRANT ALL ON member_status_overrides TO service_role;

-- Table comment
COMMENT ON TABLE member_status_overrides IS 'LOCAL: Member status overrides for special cases (hiatus, gifts, special) - tracks exceptions to default status rules';
