set lock_timeout = '5s';

-- When a member's own token last read a conversation's history (a 1:1 DM, or a group DM only members' tokens read). Both people in
-- a DM, and everyone in such a group, see the same Slack conversation, so one of them reading it is enough: a pull skips one that
-- was read a moment ago, whoever read it, instead of every member calling Slack for it. Null = never read. The marker is also what
-- lets a pull remember a DM it found empty, without making a chat conversation for it.
ALTER TABLE bronze.slack_channels ADD COLUMN IF NOT EXISTS last_pulled_at TIMESTAMPTZ;

COMMENT ON COLUMN bronze.slack_channels.last_pulled_at IS
  'When a member''s own Slack token last read this conversation''s history (lib/chat/slack-dms.ts); null if never. Only DMs and group DMs the bot is not in.';

-- raw_payload is hidden from signed-in users on this table; each other column needs its own grant (slack_content_privacy.test.sql).
GRANT SELECT (last_pulled_at) ON bronze.slack_channels TO authenticated;
