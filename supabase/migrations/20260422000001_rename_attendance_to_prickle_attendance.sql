-- Rename attendance table to prickle_attendance for consistency with architecture foundation
-- This aligns with the naming convention where prickle-related tables use the "prickle_" prefix

-- Rename the table
ALTER TABLE attendance RENAME TO prickle_attendance;

-- Update table comment to reflect Silver layer and reprocessability pattern
COMMENT ON TABLE prickle_attendance IS 'SILVER: Reprocessable from bronze.zoom_attendees. Records member attendance at prickles. Multiple records per (member_id, prickle_id) are allowed to track leave/rejoin patterns. Use COUNT(DISTINCT prickle_id) to count unique prickles attended.';
