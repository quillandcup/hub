-- An idempotency key for watch segments. The player makes one id per stretch when it closes and
-- resends it if a save fails, so a retry whose first attempt actually arrived (the response was
-- lost) is ignored instead of writing the stretch twice. It is a separate column, not the primary
-- key: row ids are always produced by the server. Null on rows saved before this existed (NULLs
-- are distinct, so they never collide). A plain unique index, not a partial one, so PostgREST can
-- name it in on_conflict. The table keeps its existing grants and policies.

ALTER TABLE public.video_watch_segments ADD COLUMN client_segment_id UUID;

CREATE UNIQUE INDEX video_watch_segments_client_segment_idx
  ON public.video_watch_segments (member_id, client_segment_id);

COMMENT ON COLUMN public.video_watch_segments.client_segment_id IS
  'Made by the player when a stretch closes; (member_id, client_segment_id) is unique so a resent save is a no-op. Null on older rows.';
