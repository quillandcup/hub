-- Where the Google Calendar sync has got to, per calendar, so a push notification can fetch only
-- what changed since (events.list updatedMin) instead of re-importing the whole window, and so
-- notifications that arrive while a sync is running coalesce into one more run instead of a pile-up.
-- Server-written only (service role). Natural key: the Google calendar id (not ours, so no id prefix).

CREATE TABLE public.calendar_sync_state (
  calendar_id text PRIMARY KEY,
  -- When the last successful sync started: everything the calendar changed before it is in Bronze.
  synced_through timestamptz,
  -- Set while a sync holds the claim; a claim older than a few minutes is treated as abandoned.
  running_since timestamptz,
  -- A notification arrived while a sync was running: it runs once more before letting go.
  rerun_requested boolean NOT NULL DEFAULT false
);

ALTER TABLE public.calendar_sync_state ENABLE ROW LEVEL SECURITY;
-- Default privileges would otherwise hand the new table to anon and authenticated.
REVOKE ALL ON public.calendar_sync_state FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.calendar_sync_state TO service_role;

COMMENT ON TABLE public.calendar_sync_state IS
  'Google Calendar sync watermark and run claim per calendar (incremental sync from push notifications). Service role only.';
