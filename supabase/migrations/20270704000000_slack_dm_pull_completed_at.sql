set lock_timeout = '5s';

-- When a member's DM pull last finished everything it set out to read (nothing left over for lack of time, no errors). dms_pulled_at is stamped
-- when a pull starts, so it cannot say whether the pull got through; the nightly run (and the admin's "pull everyone" button) skips a member
-- whose pull finished recently instead of listing their conversations again, which Slack's shared rate limit made the slow part.
ALTER TABLE public.member_slack_connections ADD COLUMN IF NOT EXISTS dms_completed_at TIMESTAMPTZ;
COMMENT ON COLUMN public.member_slack_connections.dms_completed_at IS 'When this member''s nightly DM pull last finished completely (nothing left unread for lack of time, no errors); null if never.';
