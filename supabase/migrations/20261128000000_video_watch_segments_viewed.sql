-- A "viewed" marker per player session, in the same table as the watched stretches: one row when the
-- lesson's player appears, whether or not anything is played. It is the denominator for play rate
-- (plays / views) and carries the browser's user agent for the per-viewer device. Written by the
-- player through POST /api/courses/watch like the stretches, the same way (first-party course data,
-- not the consent-gated analytics events).
--
-- Reuses the idempotency key: the marker's client_segment_id is its player session id, so a resend
-- is a no-op without a second unique index (PostgREST can't name a partial one in on_conflict).
-- A marker is a point at the start of the video, so the table's start/end checks and defaults hold.
-- Existing rows are stretches ('watched'). The table keeps its grants and policies.

ALTER TABLE public.video_watch_segments
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'watched' CHECK (kind IN ('watched', 'viewed')),
  ADD COLUMN user_agent TEXT CHECK (char_length(user_agent) <= 512);

ALTER TABLE public.video_watch_segments
  ADD CONSTRAINT video_watch_segments_viewed_is_a_point
  CHECK (kind <> 'viewed' OR (start_seconds = 0 AND end_seconds = 0));

COMMENT ON COLUMN public.video_watch_segments.kind IS
  '''watched'' = a continuous stretch; ''viewed'' = the player appeared for this session (a point at 0, client_segment_id = the session id). Anything counting stretches filters on kind.';
COMMENT ON COLUMN public.video_watch_segments.user_agent IS
  'The browser''s user agent, on ''viewed'' rows only (what device a view came from).';
