-- Sending the course player's playback quality to Mux Data (start time, buffering, errors; it carries the viewer's IP
-- address, browser and device) starts off for everyone. An admin turns it on for themselves first (preview), checks the
-- Mux Data dashboard shows views and errors, then a segment, then everyone, from the feature flags admin UI.
INSERT INTO feature_flags (feature_key, enabled_globally)
VALUES ('mux_data', false)
ON CONFLICT (feature_key) DO NOTHING;
