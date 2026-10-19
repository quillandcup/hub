-- Retire the in_app_notifications feature flag.
-- In-app notifications are now on for everyone and the app no longer checks
-- this key (removed in #143).
--
-- Remove its leftover rows so the admin feature-flag UI (which lists every
-- key present in feature_flags / feature_flag_segments) and per-user preview
-- lists don't show a stale flag.

DELETE FROM feature_flag_segments
WHERE feature_key = 'in_app_notifications';

DELETE FROM feature_flags
WHERE feature_key = 'in_app_notifications';

DELETE FROM user_feature_previews
WHERE feature_key = 'in_app_notifications';
