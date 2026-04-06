-- Remove unique constraint on (member_id, prickle_id) to allow multiple attendance records
-- This is necessary because people can leave and rejoin the same meeting/prickle
--
-- Example: Alice joins a 2-hour prickle at 9am, leaves at 9:30am, rejoins at 11am, stays until 11:30am
-- Before: Could only store one record (either first session or merged)
-- After: Two records - (9:00-9:30) and (11:00-11:30) - preserving actual attendance pattern

-- Drop the unique constraint
ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_member_id_prickle_id_key;

-- Add a comment explaining why we allow duplicates
COMMENT ON TABLE attendance IS 'Records member attendance at prickles. Multiple records per (member_id, prickle_id) are allowed to track leave/rejoin patterns. Use COUNT(DISTINCT prickle_id) to count unique prickles attended.';
