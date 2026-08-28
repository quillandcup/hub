-- "Hedgie Roulette" is being renamed to "Wheel of Wonder" (moving away from
-- gambling-adjacent naming). lib/features.ts's FeatureKey union and
-- FEATURE_PREVIEWS entry were renamed from 'hedgie_roulette' to
-- 'wheel_of_wonder' in the same change. user_feature_previews.feature_key
-- has no CHECK constraint (see 20260612000003_create_user_feature_previews.sql)
-- so nothing there needs altering -- but existing opt-in rows do, or anyone
-- who already enabled the old key silently loses access to the renamed
-- feature.

UPDATE user_feature_previews
SET feature_key = 'wheel_of_wonder'
WHERE feature_key = 'hedgie_roulette';
