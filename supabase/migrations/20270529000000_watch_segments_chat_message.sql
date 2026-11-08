-- Which chat message a stretch of a lesson video was watched in, when it was watched from a message that shares the
-- video (behind the `chat_videos` feature). Null for everything watched on the lesson page, which is all that exists
-- today. The staff watch stats keep the two apart: a lesson's numbers stay about the lesson, and chat views are
-- reported beside them. The message is not history worth keeping (SET NULL), the stretches are.
set lock_timeout = '5s';

ALTER TABLE public.video_watch_segments ADD COLUMN chat_message_id text;

ALTER TABLE public.video_watch_segments
  ADD CONSTRAINT video_watch_segments_chat_message_id_fkey
  FOREIGN KEY (chat_message_id) REFERENCES public.chat_messages(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE public.video_watch_segments VALIDATE CONSTRAINT video_watch_segments_chat_message_id_fkey;

COMMENT ON COLUMN public.video_watch_segments.chat_message_id IS
  'The chat message that shares this video, when the stretch (or the viewed marker) was watched from it; null when watched on the lesson page.';
