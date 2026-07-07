-- Server-side function to prune stale bronze calendar events.
--
-- The JS sync route's SELECT on bronze.calendar_events silently returns empty
-- for authenticated (cookie-based) callers, so stale record detection in JS
-- never fires. Running this as SECURITY DEFINER bypasses that and works
-- reliably for both authenticated users and service_role.
--
-- Safety: if p_current_google_ids is empty the function returns 0 without
-- deleting anything, so a bad/empty Google Calendar response can't wipe data.

CREATE OR REPLACE FUNCTION delete_stale_calendar_events(
  p_time_min TIMESTAMPTZ,
  p_time_max TIMESTAMPTZ,
  p_current_google_ids TEXT[]
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  IF p_current_google_ids IS NULL OR cardinality(p_current_google_ids) = 0 THEN
    RETURN 0;
  END IF;

  WITH deleted AS (
    DELETE FROM bronze.calendar_events
    WHERE start_time >= p_time_min
      AND start_time < p_time_max
      AND google_event_id != ALL(p_current_google_ids)
    RETURNING id
  )
  SELECT COUNT(*) INTO deleted_count FROM deleted;

  RETURN deleted_count;
END;
$$;

GRANT EXECUTE ON FUNCTION delete_stale_calendar_events(TIMESTAMPTZ, TIMESTAMPTZ, TEXT[])
  TO authenticated, service_role;
