-- The member-facing courses pages stay off until launch day; an admin turns them on for a user,
-- a segment or everyone from the feature flags admin UI (docs/COURSES.md).
INSERT INTO feature_flags (feature_key, enabled_globally)
VALUES ('courses', false)
ON CONFLICT (feature_key) DO NOTHING;
