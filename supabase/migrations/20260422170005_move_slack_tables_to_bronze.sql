-- Move all Slack bronze tables to bronze schema
ALTER TABLE IF EXISTS public.slack_messages SET SCHEMA bronze;
ALTER TABLE IF EXISTS public.slack_reactions SET SCHEMA bronze;
ALTER TABLE IF EXISTS public.slack_channels SET SCHEMA bronze;
ALTER TABLE IF EXISTS public.slack_users SET SCHEMA bronze;

-- Update comments to match architecture
COMMENT ON TABLE bronze.slack_messages IS 'BRONZE: Raw Slack messages from all accessible channels (UPSERT by channel_id + message_ts)';
COMMENT ON TABLE bronze.slack_reactions IS 'BRONZE: Raw Slack reactions on messages (UPSERT by channel_id + message_ts + reaction + user_id)';
COMMENT ON TABLE bronze.slack_channels IS 'BRONZE: Slack channels catalog (UPSERT by channel_id)';
COMMENT ON TABLE bronze.slack_users IS 'BRONZE: Slack users catalog (UPSERT by user_id)';
