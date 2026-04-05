-- Add 'zoom' as valid source for prickles and add zoom_meeting_uuid field

-- Drop the existing constraint
ALTER TABLE prickles DROP CONSTRAINT IF EXISTS prickles_source_check;

-- Add new constraint with 'zoom' included
ALTER TABLE prickles ADD CONSTRAINT prickles_source_check
  CHECK (source IN ('calendar', 'slack', 'sheets', 'zoom'));

-- Add zoom_meeting_uuid to track which Zoom meeting created this prickle
ALTER TABLE prickles
  ADD COLUMN zoom_meeting_uuid TEXT;

-- Index for querying prickles by Zoom meeting
CREATE INDEX IF NOT EXISTS idx_prickles_zoom_meeting_uuid ON prickles(zoom_meeting_uuid);

COMMENT ON COLUMN prickles.zoom_meeting_uuid IS 'Zoom meeting UUID if this prickle was created from a Zoom meeting';
