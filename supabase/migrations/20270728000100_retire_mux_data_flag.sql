-- Retire the mux_data feature flag.
-- Mux Data (how well course videos play, consent-gated) is now on for everyone and the app no longer checks this key.
--
-- Remove its leftover rows so the admin feature-flag UI (which lists every key present in feature_flags /
-- feature_flag_segments) and per-user preview lists don't show a stale flag. Code still running during the deploy
-- finds no flag and simply doesn't start Mux Data for those few minutes.

DELETE FROM feature_flag_segments
WHERE feature_key = 'mux_data';

DELETE FROM feature_flags
WHERE feature_key = 'mux_data';

DELETE FROM user_feature_previews
WHERE feature_key = 'mux_data';
