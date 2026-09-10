-- Partial unique index scoped only to the new 'access_events' source, so it
-- can dedupe login-mirror upserts (one member_activities row per
-- auth.sessions.id) without needing to validate against any pre-existing
-- Slack/writing-progress rows.
CREATE UNIQUE INDEX idx_member_activities_login_dedup
  ON member_activities (source, related_id) WHERE source = 'access_events';
