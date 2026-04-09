-- Add Slack activity types to activity_types table

INSERT INTO activity_types (code, name, category, default_engagement_value, description) VALUES
('slack_message', 'Slack Message', 'communication', 1, 'Posted a message in Slack'),
('slack_thread_reply', 'Slack Thread Reply', 'communication', 2, 'Replied in a Slack thread'),
('slack_reaction', 'Slack Reaction', 'communication', 1, 'Reacted to a Slack message')
ON CONFLICT (code) DO UPDATE SET
  default_engagement_value = EXCLUDED.default_engagement_value,
  description = EXCLUDED.description;
