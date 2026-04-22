-- Add LOCAL comments to all local layer tables
-- Local layer = operational data owned by this application (not derived from external systems)

COMMENT ON TABLE staff IS 'LOCAL: Staff roster (owners, staff, contractors) - source of truth for team members';
COMMENT ON TABLE prickle_types IS 'LOCAL: Prickle type definitions for categorizing events - manually maintained';
COMMENT ON TABLE member_name_aliases IS 'LOCAL: Manual name corrections and aliases for matching members across systems';
COMMENT ON TABLE ignored_zoom_names IS 'LOCAL: Zoom display names to exclude from attendance (bots, test users, etc)';
COMMENT ON TABLE member_hiatus_history IS 'LOCAL: Member hiatus tracking - manually managed operational data';
COMMENT ON TABLE ignored_slack_users IS 'LOCAL: Slack users to exclude from activity tracking (bots, test users, etc)';
COMMENT ON TABLE user_profiles IS 'LOCAL: Admin portal user preferences and settings';
