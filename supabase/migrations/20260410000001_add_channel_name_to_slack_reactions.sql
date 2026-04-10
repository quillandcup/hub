-- Add channel_name to slack_reactions for easier querying
ALTER TABLE slack_reactions
ADD COLUMN IF NOT EXISTS channel_name TEXT;

-- Create index for channel name filtering
CREATE INDEX IF NOT EXISTS idx_slack_reactions_channel_name ON slack_reactions(channel_name);
