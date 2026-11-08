-- A course lesson's video shared into a chat message, played in the message by the Hub (behind the `chat_videos` feature).
-- It is its own table, not an entry in chat_message_contents.files: the trigger chat_fill_content_files rewrites `files`
-- from Slack's copy of the message, which would wipe a Hub-only entry. The row only points at the lesson; the
-- playback links are minted per viewer by /api/chat/videos/<message id>, after the channel check and the course check.
set lock_timeout = '5s';

INSERT INTO feature_flags (feature_key, enabled_globally)
VALUES ('chat_videos', false)
ON CONFLICT (feature_key) DO NOTHING;

CREATE TABLE public.chat_message_videos (
  id text PRIMARY KEY DEFAULT public.new_id('cmv'),
  message_id text NOT NULL UNIQUE REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  lesson_id text NOT NULL REFERENCES public.course_lessons(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.chat_message_videos IS
  'The course lesson whose video a chat message shares (one per message), written by the share action with the service role after it checked the sharer can open the lesson. Never holds playback links. [id prefix: cmv_]';

CREATE INDEX chat_message_videos_lesson_id_idx ON public.chat_message_videos (lesson_id);

ALTER TABLE public.chat_message_videos ENABLE ROW LEVEL SECURITY;

-- Whoever can read the message's content can see that it shares a video; whether they may play it is decided
-- by the token route (course access), not here.
CREATE POLICY "Read the video of readable messages" ON public.chat_message_videos
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.chat_messages m
    WHERE m.id = chat_message_videos.message_id AND public.chat_can_read_content(m.channel_id)
  ));

-- Older projects still hand every new public table to anon and authenticated by default; say what this one allows.
REVOKE ALL ON public.chat_message_videos FROM anon, authenticated;
GRANT SELECT ON public.chat_message_videos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_message_videos TO service_role;
