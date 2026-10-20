-- Retire the slack_notifications rollout flag after the code gate was removed in #148.
-- Automatic Slack DMs now follow member notification preferences and safe account matching.
-- Remove stale admin and per-user preview rows after the new code is in production.

DELETE FROM feature_flag_segments
WHERE feature_key = 'slack_notifications';

DELETE FROM feature_flags
WHERE feature_key = 'slack_notifications';

DELETE FROM user_feature_previews
WHERE feature_key = 'slack_notifications';
