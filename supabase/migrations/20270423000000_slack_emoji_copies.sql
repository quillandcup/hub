set lock_timeout = '5s';

-- Custom emoji are served from our own storage, not from Slack's CDN. The CDN sends no CORS headers, so the browser
-- can't read an image to make a still of it (Animations off), and its URLs are not ours to depend on. The emoji sync
-- copies each image into the public slack-emoji bucket and, for an animated one, a still first frame beside it.
-- Expand step: the columns are additive and nothing reads them until the code that fills them is live; image_url stays
-- as the fallback until an emoji has been copied.
ALTER TABLE bronze.slack_custom_emoji
  ADD COLUMN IF NOT EXISTS image_path TEXT,
  ADD COLUMN IF NOT EXISTS still_path TEXT,
  ADD COLUMN IF NOT EXISTS copied_from_url TEXT;

COMMENT ON COLUMN bronze.slack_custom_emoji.image_path IS 'Path of our copy of the image in the slack-emoji bucket (content hash + extension, so it never changes under a URL).';
COMMENT ON COLUMN bronze.slack_custom_emoji.still_path IS 'Path of the still first frame (PNG) of an animated image, in the same bucket; null when the image does not move.';
COMMENT ON COLUMN bronze.slack_custom_emoji.copied_from_url IS 'The image_url the copy was made from; a different image_url means the emoji changed and is copied again.';

-- Public: custom emoji are the workspace's public decoration (see lib/chat/names.ts), and the browser loads them directly.
INSERT INTO storage.buckets (id, name, public)
VALUES ('slack-emoji', 'slack-emoji', true)
ON CONFLICT (id) DO NOTHING;
