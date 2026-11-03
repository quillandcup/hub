set lock_timeout = '5s';

-- A draft keeps the files attached to it: the staged copies in the private slack-files bucket
-- ({path, name, mimetype, size} each, see lib/chat/staging.ts). A draft may now be files only.

ALTER TABLE public.chat_drafts ADD COLUMN files jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Approved ban-drop-constraint ignore: chat_drafts is brand new (#910) and its code never relied on this check beyond refusing a blank body, which the replacement relaxes when files are attached.
-- squawk-ignore ban-drop-constraint
ALTER TABLE public.chat_drafts DROP CONSTRAINT chat_drafts_body_check;

ALTER TABLE public.chat_drafts ADD CONSTRAINT chat_drafts_content_check CHECK (
  length(body) <= 4000
  AND jsonb_typeof(files) = 'array'
  AND jsonb_array_length(files) <= 10
  AND (length(btrim(body)) > 0 OR jsonb_array_length(files) > 0)
) NOT VALID;
ALTER TABLE public.chat_drafts VALIDATE CONSTRAINT chat_drafts_content_check;

COMMENT ON COLUMN public.chat_drafts.files IS
  'Files attached to the draft: [{path, name, mimetype, size}], staged copies in the slack-files bucket. Their bytes are removed when a file leaves the draft, and the staging purge skips them while a draft lists them.';
