-- Store each Slack user's profile photo URL so member processing can use it
-- as an avatar fallback (Kajabi photo -> Slack photo -> Gravatar -> initials)
-- for members who never uploaded a Kajabi avatar or set up Gravatar.
ALTER TABLE bronze.slack_users
  ADD COLUMN IF NOT EXISTS image_url TEXT;

COMMENT ON COLUMN bronze.slack_users.image_url IS 'Slack profile photo URL (profile.image_192, falling back to image_512) from the Slack API';
