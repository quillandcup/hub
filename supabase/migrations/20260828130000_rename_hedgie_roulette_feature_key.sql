-- "Hedgie Roulette" is being renamed to "Wheel of Wonder" (moving away from
-- gambling-adjacent naming). lib/features.ts's FeatureKey union and
-- FEATURE_PREVIEWS entry were renamed from 'hedgie_roulette' to
-- 'wheel_of_wonder' in the same change. user_feature_previews.feature_key
-- has no CHECK constraint (see 20260612000003_create_user_feature_previews.sql)
-- so nothing there needs altering -- but existing opt-in rows do, or anyone
-- who already enabled the old key silently loses access to the renamed
-- feature.
--
-- This migration shipped in code before it was ever applied to the remote
-- database, and the app had already been reading/writing the new
-- 'wheel_of_wonder' key in the meantime -- so some users already have both a
-- 'hedgie_roulette' row (from before the app-level rename) and a
-- 'wheel_of_wonder' row (opted in after) under the same user_id, which the
-- primary key (user_id, feature_key) won't allow a plain rename to collapse.
-- Drop the now-redundant old-key row first so the rename below is safe to
-- rerun regardless of which rows already exist.

DELETE FROM user_feature_previews old
USING user_feature_previews new
WHERE old.feature_key = 'hedgie_roulette'
  AND new.feature_key = 'wheel_of_wonder'
  AND old.user_id = new.user_id;

UPDATE user_feature_previews
SET feature_key = 'wheel_of_wonder'
WHERE feature_key = 'hedgie_roulette';
