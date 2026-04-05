-- Add Google Calendar event ID to prickles for deduplication
ALTER TABLE prickles
ADD COLUMN google_calendar_event_id TEXT;

-- Create unique index to prevent duplicate imports
CREATE UNIQUE INDEX idx_prickles_google_calendar_event_id
ON prickles(google_calendar_event_id)
WHERE google_calendar_event_id IS NOT NULL;

COMMENT ON COLUMN prickles.google_calendar_event_id IS 'Google Calendar event ID for imported events (used for deduplication)';
