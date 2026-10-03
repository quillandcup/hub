-- BRONZE: Zoom meeting.participant_joined / meeting.participant_left webhook events, as received.
-- Zoom's Report API (the attendance import) only covers meetings that have ended, so while a
-- meeting runs these events are the only record of who's in the room. The prickle check-out DM
-- (lib/prickle-checkin-dms.ts) uses them to send at a prickle's scheduled end, and to early
-- leavers, without waiting for the meeting to end. The attendance import after the meeting ends
-- stays the source of truth and the backstop for any lost webhook.
--
-- Append-only. Zoom retries deliveries, so the UNIQUE key makes a redelivered event a no-op.
-- participant_key is Zoom's participant_uuid (per participant per meeting), falling back to its
-- user_id. host_id is the meeting host's Zoom user id: the subscription may cover the whole Zoom
-- account, so presence only counts meetings whose host the attendance import covers (see
-- lib/zoom-presence.ts). Service role only (the webhook writes, the cron reads).
CREATE TABLE IF NOT EXISTS bronze.zoom_participant_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_uuid TEXT NOT NULL,
  meeting_id TEXT,
  host_id TEXT,
  event TEXT NOT NULL CHECK (event IN ('joined', 'left')),
  participant_key TEXT NOT NULL,
  participant_name TEXT,
  participant_email TEXT,
  event_time TIMESTAMPTZ NOT NULL,
  leave_reason TEXT,
  raw_payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (meeting_uuid, participant_key, event, event_time)
);

CREATE INDEX IF NOT EXISTS zoom_participant_events_event_time_idx ON bronze.zoom_participant_events (event_time);

COMMENT ON TABLE bronze.zoom_participant_events IS
  'BRONZE: Zoom participant joined/left webhook events (live presence while a meeting runs). Service role only.';

ALTER TABLE bronze.zoom_participant_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON bronze.zoom_participant_events FROM anon, authenticated;
GRANT ALL ON bronze.zoom_participant_events TO service_role;
