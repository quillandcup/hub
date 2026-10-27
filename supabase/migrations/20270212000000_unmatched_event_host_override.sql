-- An admin can correct the host of a calendar prickle by hand. Like the type (resolved_type_id), the
-- choice is stored on the event's decision row, because /api/process/calendar rebuilds every
-- calendar prickle from the calendar and would otherwise overwrite it.
ALTER TABLE public.unmatched_calendar_events
  ADD COLUMN IF NOT EXISTS resolved_host_id text REFERENCES public.members(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.unmatched_calendar_events.resolved_host_id IS
  'Host chosen by an admin for this calendar event; wins over the "w/Name" matched from the title when set.';
