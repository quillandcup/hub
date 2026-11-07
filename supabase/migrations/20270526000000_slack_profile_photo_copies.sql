set lock_timeout = '5s';

-- Slack profile photos are served from our own storage, not from Slack's CDN. The photo is the avatar fallback in chat
-- and in members.photo_url (Kajabi, then Slack, then Gravatar), and its URL is Slack's to change or take down. The
-- Slack import copies each photo into the public slack-avatars bucket, keyed by Slack user id and the content's hash.
-- Expand step: the columns are additive and nothing reads them until the code that fills them is live; image_url stays
-- as the fallback until a photo has been copied.
ALTER TABLE bronze.slack_users
  ADD COLUMN IF NOT EXISTS image_path TEXT,
  ADD COLUMN IF NOT EXISTS copied_from_url TEXT;

COMMENT ON COLUMN bronze.slack_users.image_path IS 'Path of our copy of the profile photo in the slack-avatars bucket (<Slack user id>/<content hash>.<ext>, so it never changes under a URL); null until copied, and again once the user is deactivated or removes the photo.';
COMMENT ON COLUMN bronze.slack_users.copied_from_url IS 'The image_url the copy was made from; a different image_url means the photo changed and is copied again.';

-- A column added to a table with column grants needs its own (slack_content_privacy.test.sql).
GRANT SELECT (image_path, copied_from_url) ON bronze.slack_users TO authenticated;

-- Public, like Slack's own avatar CDN and the slack-emoji bucket: the browser loads a photo directly.
INSERT INTO storage.buckets (id, name, public)
VALUES ('slack-avatars', 'slack-avatars', true)
ON CONFLICT (id) DO NOTHING;
