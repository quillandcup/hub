-- A deleted chat message must stop sharing its lesson video at once. Deleting is a soft delete (chat_messages.deleted_at; the
-- share row stays), and the read policy only asked whether the viewer could read the channel, so anyone who still knew the
-- message id could ask the playback route for the video, including a lesson an admin had opened to the whole channel.
-- The policy now also requires the message to be live. The app's repository filters the same way (lib/data/chat-videos.ts).
-- Tightening only: code from before this still works (a deleted message's share is simply not found).
set lock_timeout = '5s';

DROP POLICY IF EXISTS "Read the video of readable messages" ON public.chat_message_videos;
CREATE POLICY "Read the video of readable messages" ON public.chat_message_videos
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.chat_messages m
    WHERE m.id = chat_message_videos.message_id
      AND m.deleted_at IS NULL
      AND public.chat_can_read_content(m.channel_id)
  ));
