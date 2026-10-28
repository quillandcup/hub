-- Google Calendar push ("watch") channels the app has opened, so /api/reconcile/calendar can renew
-- one before it expires and stop the one it replaces. Google has no call that lists channels: a
-- channel is stopped only by its id and resource id from the original watch response.
-- Server-written only (service role); never exposed by id.

CREATE TABLE public.calendar_watch_channels (
  id text PRIMARY KEY DEFAULT public.new_id('cwch'),
  calendar_id text NOT NULL,
  -- The id we chose for the channel; Google echoes it in X-Goog-Channel-Id.
  channel_id text NOT NULL UNIQUE,
  -- Google's id for the watched resource; needed with channel_id to stop the channel.
  resource_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Set when we replaced the channel (or Google reported it already gone).
  stopped_at timestamptz
);

ALTER TABLE public.calendar_watch_channels ENABLE ROW LEVEL SECURITY;
-- Default privileges would otherwise hand the new table to anon and authenticated.
REVOKE ALL ON public.calendar_watch_channels FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.calendar_watch_channels TO service_role;

COMMENT ON TABLE public.calendar_watch_channels IS
  'Google Calendar push channels opened by the app (renewed by /api/reconcile/calendar). Service role only. [id prefix: cwch_]';
