-- The previous backfill left messages with no conversation row and no type in their payload: the bot's own posts into members' 1:1 DMs
-- (the bot's DMs are not listed in bronze.slack_channels). A Slack id starting with D is a 1:1 DM, which is what those are.
UPDATE bronze.slack_messages
SET channel_type = 'im'
WHERE channel_type IS NULL AND channel_id ~ '^D[A-Z0-9]+$';
