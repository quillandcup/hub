-- An admin can correct the title, description and guest speaker of a calendar prickle by hand, as they
-- can its type (resolved_type_id) and host (resolved_host_id). The choice is kept on the calendar event's
-- decision row because /api/process/calendar rebuilds every calendar prickle from the calendar and would
-- otherwise overwrite it. Null means follow the calendar, so clearing a field on the prickle brings the
-- calendar's text back.

ALTER TABLE public.unmatched_calendar_events
  ADD COLUMN IF NOT EXISTS resolved_title text,
  ADD COLUMN IF NOT EXISTS resolved_description text,
  ADD COLUMN IF NOT EXISTS resolved_guest_speaker text;

COMMENT ON COLUMN public.unmatched_calendar_events.resolved_title IS 'Title an admin gave this calendar prickle; wins over the one made from the calendar title. Null follows the calendar.';
COMMENT ON COLUMN public.unmatched_calendar_events.resolved_description IS 'Description an admin gave this calendar prickle; wins over the calendar description. Null follows the calendar.';
COMMENT ON COLUMN public.unmatched_calendar_events.resolved_guest_speaker IS 'Guest speaker an admin gave this calendar prickle; wins over the one made from the calendar title. Null follows the calendar.';
