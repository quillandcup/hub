-- Keep automatic Slack DMs off until an admin selects a pilot cohort or enables everyone.
INSERT INTO feature_flags (feature_key, enabled_globally)
VALUES ('slack_notifications', false)
ON CONFLICT (feature_key) DO NOTHING;
