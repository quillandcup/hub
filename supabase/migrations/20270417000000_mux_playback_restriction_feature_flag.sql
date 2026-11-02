-- Enforcing the Mux playback restriction on course video tokens starts off for everyone. A wrong domain
-- list or id would stop every member's video, so an admin turns it on for themselves first (preview),
-- then a segment, then everyone, from the feature flags admin UI.
INSERT INTO feature_flags (feature_key, enabled_globally)
VALUES ('mux_playback_restriction', false)
ON CONFLICT (feature_key) DO NOTHING;
