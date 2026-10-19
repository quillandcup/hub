-- The On air light in the member header stays off until an admin enables it for a cohort or everyone.
INSERT INTO feature_flags (feature_key, enabled_globally)
VALUES ('live_room', false)
ON CONFLICT (feature_key) DO NOTHING;
