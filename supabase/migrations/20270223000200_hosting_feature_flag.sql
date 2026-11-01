-- Member-facing hosting (My Prickles -> Hosting, host vibe settings, the hosting tour steps) is hidden
-- until the change of process is agreed; an admin turns it on for a user, a segment or everyone from
-- the feature flags admin UI.
INSERT INTO feature_flags (feature_key, enabled_globally)
VALUES ('hosting', false)
ON CONFLICT (feature_key) DO NOTHING;
