-- Who a Slack app is: the name and icon of a message posted by an app (a deploy notice, a calendar bot), so the chat
-- shows "Vercel" and its logo instead of "Slack app". Slack puts them in the message's raw payload
-- (bot_profile, or username and icons for a custom sender), and Bronze is service role only, so a compact
-- {name, icon} goes in chat_message_contents.bot, behind the same RLS as the text. Like `files`, a trigger fills it
-- from Bronze, so the two projection functions stay as they are. Expand only: nothing reads or drops anything.
set lock_timeout = '5s';

ALTER TABLE public.chat_message_contents ADD COLUMN IF NOT EXISTS bot JSONB;

COMMENT ON COLUMN public.chat_message_contents.bot IS
  'LOCAL: {name, icon?} of the Slack app that posted the message (from Bronze bot_profile / username / icons); icon is an https URL. Null for people.';

CREATE OR REPLACE FUNCTION public.chat_slack_bot_summary(p_payload JSONB) RETURNS JSONB AS $$
  SELECT CASE
    WHEN p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN NULL
    WHEN COALESCE(NULLIF(p_payload #>> '{bot_profile,name}', ''), NULLIF(p_payload->>'username', '')) IS NULL THEN NULL
    ELSE jsonb_strip_nulls(jsonb_build_object(
      'name', left(COALESCE(NULLIF(p_payload #>> '{bot_profile,name}', ''), p_payload->>'username'), 100),
      'icon', (
        SELECT t.i FROM unnest(ARRAY[
          p_payload #>> '{bot_profile,icons,image_48}',
          p_payload #>> '{bot_profile,icons,image_72}',
          p_payload #>> '{icons,image_64}',
          p_payload #>> '{icons,image_48}'
        ]) WITH ORDINALITY AS t(i, n)
        WHERE t.i ~* '^https://' AND length(t.i) <= 500
        ORDER BY t.n
        LIMIT 1
      )
    ))
  END;
$$ LANGUAGE sql IMMUTABLE SET search_path = public;

REVOKE ALL ON FUNCTION public.chat_slack_bot_summary(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_slack_bot_summary(JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.chat_fill_content_bot() RETURNS trigger AS $$
DECLARE
  v_bot JSONB;
BEGIN
  SELECT public.chat_slack_bot_summary(b.raw_payload) INTO v_bot
  FROM chat_messages cm
  JOIN chat_channels cc ON cc.id = cm.channel_id
  JOIN bronze.slack_messages b ON b.channel_id = cc.slack_channel_id AND b.message_ts = cm.slack_ts
  WHERE cm.id = NEW.message_id;
  -- No Bronze row (a message written in the Hub): nothing to fill.
  IF FOUND THEN
    NEW.bot := v_bot;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS chat_fill_content_bot ON public.chat_message_contents;
CREATE TRIGGER chat_fill_content_bot
  BEFORE INSERT OR UPDATE OF body, blocks, attachments ON public.chat_message_contents
  FOR EACH ROW EXECUTE FUNCTION public.chat_fill_content_bot();

-- Existing messages sent by an app.
UPDATE public.chat_message_contents c
SET bot = public.chat_slack_bot_summary(b.raw_payload)
FROM public.chat_messages cm
JOIN public.chat_channels cc ON cc.id = cm.channel_id
JOIN bronze.slack_messages b ON b.channel_id = cc.slack_channel_id AND b.message_ts = cm.slack_ts
WHERE c.message_id = cm.id
  AND (b.raw_payload->'bot_profile' IS NOT NULL OR b.raw_payload->'username' IS NOT NULL)
  AND public.chat_slack_bot_summary(b.raw_payload) IS NOT NULL;
