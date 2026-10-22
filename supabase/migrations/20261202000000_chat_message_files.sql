-- Files on chat messages: what the Hub shows under a message (images inline, the rest as
-- downloads). A compact list per message in chat_message_contents.files, so the same RLS that
-- gates the text gates the file names, and a deleted message shows none. The bytes are not here:
-- they are in the private slack-files bucket, served by /api/chat/files after the same check.
--
-- Slack-origin messages get the list from bronze.slack_messages.files. A trigger fills it, so the
-- two projection functions (whole window, one message) stay as they are. Messages written in the
-- Hub set it themselves, and have no Bronze row for the trigger to overwrite it with.

ALTER TABLE public.chat_message_contents ADD COLUMN IF NOT EXISTS files JSONB;

COMMENT ON COLUMN public.chat_message_contents.files IS
  'LOCAL: [{id, name, mimetype, size, width, height}] for files on the message (id is the Slack file id; bytes in the slack-files bucket).';

CREATE OR REPLACE FUNCTION public.chat_slack_files_summary(p_files JSONB) RETURNS JSONB AS $$
  SELECT CASE
    WHEN p_files IS NULL OR jsonb_typeof(p_files) <> 'array' THEN NULL
    ELSE (
      SELECT NULLIF(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', f->>'id',
        'name', COALESCE(f->>'name', f->>'title'),
        'mimetype', f->>'mimetype',
        'size', CASE WHEN jsonb_typeof(f->'size') = 'number' THEN f->'size' END,
        'width', CASE WHEN jsonb_typeof(f->'original_w') = 'number' THEN f->'original_w' END,
        'height', CASE WHEN jsonb_typeof(f->'original_h') = 'number' THEN f->'original_h' END
      ))), '[]'::jsonb)
      FROM jsonb_array_elements(p_files) f
      WHERE f->>'id' IS NOT NULL
    )
  END;
$$ LANGUAGE sql IMMUTABLE SET search_path = public;

REVOKE ALL ON FUNCTION public.chat_slack_files_summary(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_slack_files_summary(JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.chat_fill_content_files() RETURNS trigger AS $$
DECLARE
  v_files JSONB;
BEGIN
  SELECT public.chat_slack_files_summary(b.files) INTO v_files
  FROM chat_messages cm
  JOIN chat_channels cc ON cc.id = cm.channel_id
  JOIN bronze.slack_messages b ON b.channel_id = cc.slack_channel_id AND b.message_ts = cm.slack_ts
  WHERE cm.id = NEW.message_id;
  -- No Bronze row (a message written in the Hub): keep whatever the writer set.
  IF FOUND THEN
    NEW.files := v_files;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS chat_fill_content_files ON public.chat_message_contents;
CREATE TRIGGER chat_fill_content_files
  BEFORE INSERT OR UPDATE OF body, blocks, attachments ON public.chat_message_contents
  FOR EACH ROW EXECUTE FUNCTION public.chat_fill_content_files();

-- Existing messages: the same list (prod has a few thousand Bronze messages, so one statement is fine).
UPDATE public.chat_message_contents c
SET files = public.chat_slack_files_summary(b.files)
FROM public.chat_messages cm
JOIN public.chat_channels cc ON cc.id = cm.channel_id
JOIN bronze.slack_messages b ON b.channel_id = cc.slack_channel_id AND b.message_ts = cm.slack_ts
WHERE c.message_id = cm.id
  AND cm.has_files
  AND public.chat_slack_files_summary(b.files) IS NOT NULL;
