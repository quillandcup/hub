-- Retire the streaks, prickle_picker, and wheel_of_wonder feature flags.
-- These features are now enabled for everyone and the app no longer checks
-- these keys (removed from lib/features.ts FeatureKey / FEATURE_PREVIEWS).
--
-- Remove their leftover rows so the admin feature-flag UI (which lists every
-- key present in feature_flags / feature_flag_segments) and per-user preview
-- lists don't show stale flags. feature_flag_segments rows cascade from the
-- feature_flags delete via its FK, but are deleted explicitly too in case a
-- link exists without a parent row being removed first.

DELETE FROM feature_flag_segments
WHERE feature_key IN ('streaks', 'prickle_picker', 'wheel_of_wonder');

DELETE FROM feature_flags
WHERE feature_key IN ('streaks', 'prickle_picker', 'wheel_of_wonder');

DELETE FROM user_feature_previews
WHERE feature_key IN ('streaks', 'prickle_picker', 'wheel_of_wonder', 'hedgie_roulette');
