-- Move zoom_attendees to bronze schema
ALTER TABLE IF EXISTS public.zoom_attendees SET SCHEMA bronze;

-- Create zoom_meetings table in bronze schema
-- Separate from zoom_attendees per architecture (meetings are metadata, attendees are participation records)
CREATE TABLE IF NOT EXISTS bronze.zoom_meetings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_uuid TEXT NOT NULL UNIQUE, -- Zoom's unique meeting instance ID
    meeting_id TEXT NOT NULL, -- Zoom meeting ID (can repeat for recurring meetings)
    topic TEXT NOT NULL,
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE,
    duration_minutes INTEGER,
    host_email TEXT,
    host_name TEXT,
    participant_count INTEGER,
    data JSONB NOT NULL, -- Full Zoom API response
    imported_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zoom_meetings_meeting_uuid ON bronze.zoom_meetings(meeting_uuid);
CREATE INDEX IF NOT EXISTS idx_zoom_meetings_meeting_id ON bronze.zoom_meetings(meeting_id);
CREATE INDEX IF NOT EXISTS idx_zoom_meetings_start_time ON bronze.zoom_meetings(start_time);
CREATE INDEX IF NOT EXISTS idx_zoom_meetings_imported_at ON bronze.zoom_meetings(imported_at);

-- Add trigger for updated_at
CREATE TRIGGER update_zoom_meetings_updated_at
BEFORE UPDATE ON bronze.zoom_meetings
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Update comments to match architecture
COMMENT ON TABLE bronze.zoom_attendees IS 'BRONZE: Raw Zoom participant data (UPSERT by meeting_uuid + participant_id for idempotent imports)';
COMMENT ON TABLE bronze.zoom_meetings IS 'BRONZE: Raw Zoom meeting metadata (UPSERT by meeting_uuid for idempotent imports)';
