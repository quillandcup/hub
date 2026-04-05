-- Make zoom_attendees immutable with unique constraint
-- Prevents duplicate imports of the same attendance record

-- Add unique constraint on (meeting_uuid, name, join_time)
-- This handles:
-- - Same person in different meetings (different meeting_uuid)
-- - Same person rejoining same meeting (different join_time)
-- - Different people with same name in same meeting (different join_time if not simultaneous)
CREATE UNIQUE INDEX IF NOT EXISTS idx_zoom_attendees_unique
  ON zoom_attendees(meeting_uuid, name, join_time);

COMMENT ON INDEX idx_zoom_attendees_unique IS 'Ensures immutability - prevents duplicate imports of same attendance record';
