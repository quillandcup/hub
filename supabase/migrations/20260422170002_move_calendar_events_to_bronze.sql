-- Move calendar_events table to bronze schema
-- This is a Bronze layer table (raw Google Calendar data with UPSERT by google_event_id)

ALTER TABLE IF EXISTS public.calendar_events SET SCHEMA bronze;

-- Update comment to match architecture
COMMENT ON TABLE bronze.calendar_events IS 'BRONZE: Raw Google Calendar event data (UPSERT by google_event_id for idempotent imports)';
