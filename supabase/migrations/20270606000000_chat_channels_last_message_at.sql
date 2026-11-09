set lock_timeout = '5s';

-- When a conversation last had a message, so the sidebar can list direct and group messages most recent first, as Slack
-- does. Kept by a trigger on chat_messages (any message that isn't a Slack notice, replies included) and filled in once
-- from what exists. A message deleted afterwards doesn't move it back: the order is a convenience, not a record.
ALTER TABLE public.chat_channels ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ;

COMMENT ON COLUMN public.chat_channels.last_message_at IS
  'LOCAL (derived): created_at of the newest message that is not a Slack notice, kept by chat_messages_touch_channel. For ordering the sidebar.';

UPDATE public.chat_channels c
SET last_message_at = m.last_at
FROM (
  SELECT channel_id, max(created_at) AS last_at
  FROM public.chat_messages
  WHERE deleted_at IS NULL AND system_subtype IS NULL
  GROUP BY channel_id
) m
WHERE m.channel_id = c.id;

CREATE OR REPLACE FUNCTION public.chat_touch_channel_last_message() RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE chat_channels
  SET last_message_at = NEW.created_at
  WHERE id = NEW.channel_id AND (last_message_at IS NULL OR last_message_at < NEW.created_at);
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.chat_touch_channel_last_message() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS chat_messages_touch_channel ON public.chat_messages;
CREATE TRIGGER chat_messages_touch_channel
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW
  WHEN (NEW.deleted_at IS NULL AND NEW.system_subtype IS NULL)
  EXECUTE FUNCTION public.chat_touch_channel_last_message();
