-- Create Bronze table for raw Google Calendar events
CREATE TABLE calendar_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    google_event_id TEXT NOT NULL UNIQUE,
    summary TEXT,
    description TEXT,
    location TEXT,
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE NOT NULL,
    creator_email TEXT,
    creator_name TEXT,
    organizer_email TEXT,
    organizer_name TEXT,
    raw_data JSONB NOT NULL, -- Full event data from Google
    imported_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    CONSTRAINT calendar_events_times_check CHECK (end_time > start_time)
);

CREATE INDEX idx_calendar_events_google_event_id ON calendar_events(google_event_id);
CREATE INDEX idx_calendar_events_start_time ON calendar_events(start_time);
CREATE INDEX idx_calendar_events_imported_at ON calendar_events(imported_at);

COMMENT ON TABLE calendar_events IS 'Bronze layer: Raw Google Calendar event data (unmodified)';
COMMENT ON COLUMN calendar_events.google_event_id IS 'Google Calendar event ID (used for upserts)';
COMMENT ON COLUMN calendar_events.raw_data IS 'Full event JSON from Google Calendar API';

-- Remove google_calendar_event_id from prickles (no longer needed - prickles is Silver)
DROP INDEX IF EXISTS idx_prickles_google_calendar_event_id;
ALTER TABLE prickles DROP COLUMN IF EXISTS google_calendar_event_id;

COMMENT ON TABLE prickles IS 'Silver layer: Canonical prickle events (processed from calendar_events, zoom_attendees, etc)';
