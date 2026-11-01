-- Events that come from the shared Google calendar. An admin shows a calendar item in Events
-- (or edits it), which creates an events row linked to the Bronze calendar event. Its title,
-- description and location follow the calendar until an admin changes them: a changed field is
-- recorded in overridden_fields and the calendar sync no longer touches it. start_time/end_time
-- keep the exact instants (starts_at/ends_at stay the Eastern calendar dates).
--
-- If the calendar event is deleted in Google, the link is cleared and the row keeps its last values.

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS calendar_event_id UUID REFERENCES bronze.calendar_events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS overridden_fields TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS start_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS end_time TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS events_calendar_event_id_key ON events (calendar_event_id) WHERE calendar_event_id IS NOT NULL;

ALTER TABLE events DROP CONSTRAINT IF EXISTS events_overridden_fields_check;
ALTER TABLE events ADD CONSTRAINT events_overridden_fields_check
  CHECK (overridden_fields <@ ARRAY['title', 'description', 'location']);
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_times_check;
ALTER TABLE events ADD CONSTRAINT events_times_check
  CHECK ((start_time IS NULL) = (end_time IS NULL) AND (start_time IS NULL OR end_time > start_time));

COMMENT ON COLUMN events.calendar_event_id IS 'The Bronze calendar event this row follows; null for an event made in the Hub. Cleared (ON DELETE SET NULL) if the calendar event is deleted.';
COMMENT ON COLUMN events.overridden_fields IS 'Fields an admin changed on a calendar-linked event (title, description, location); the calendar sync leaves them alone.';
COMMENT ON COLUMN events.start_time IS 'Exact start, set for calendar events. starts_at is its Eastern date.';
COMMENT ON COLUMN events.end_time IS 'Exact end, set for calendar events. ends_at is the Eastern date it ends on.';
