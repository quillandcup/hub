-- Add default_host_id to prickle_types for auto-assignment when no "w/Name" pattern found
-- This allows setting a default host for recurring community prickles (e.g., "Heads Down hosted by Katie")

ALTER TABLE prickle_types
  ADD COLUMN IF NOT EXISTS default_host_id UUID REFERENCES members(id) ON DELETE SET NULL;

-- Add index for joins
CREATE INDEX IF NOT EXISTS idx_prickle_types_default_host ON prickle_types(default_host_id);

COMMENT ON COLUMN prickle_types.default_host_id IS
  'Default host for this prickle type. Used when processing calendar events with no "w/Name" pattern.';
