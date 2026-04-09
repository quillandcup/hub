-- Non-members to exclude from matching reports

CREATE TABLE IF NOT EXISTS ignored_slack_users (
    user_id TEXT PRIMARY KEY,
    reason TEXT, -- 'non_member', 'bot', 'guest'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

COMMENT ON TABLE ignored_slack_users IS 'Slack users marked as non-members (skip from matching reports)';

-- Grant permissions
GRANT ALL ON ignored_slack_users TO authenticated, service_role;
