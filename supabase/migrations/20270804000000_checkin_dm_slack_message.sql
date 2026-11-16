-- Check-in and check-out DMs: remember which Slack message each one is, so that answering the check-in anywhere
-- (the Hub, Log Progress) can collapse the DM and clear its unread badge. Expand-only: three nullable columns on the
-- existing DM log; nothing the live code reads or writes changes meaning. DMs logged before this have no message
-- timestamp and are left as they are.

set lock_timeout = '5s';

ALTER TABLE public.prickle_checkin_dm_log
  ADD COLUMN slack_channel_id text,
  ADD COLUMN slack_ts text,
  ADD COLUMN closed_at timestamptz;

COMMENT ON COLUMN public.prickle_checkin_dm_log.slack_channel_id IS 'The Slack DM conversation the message was posted in (null for a DM sent before this was kept).';
COMMENT ON COLUMN public.prickle_checkin_dm_log.slack_ts IS 'The posted message''s Slack timestamp; with slack_channel_id it addresses the message for chat.update and the read marker.';
COMMENT ON COLUMN public.prickle_checkin_dm_log.closed_at IS 'When the DM was collapsed to its closed note after the check-in was answered elsewhere; null while it is still live.';
