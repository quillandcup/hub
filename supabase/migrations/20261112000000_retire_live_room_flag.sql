-- The On air light is now enabled for everyone. Remove the retired flag from
-- the admin registry, segment assignments, and per-user preview lists.

DELETE FROM feature_flag_segments
WHERE feature_key = 'live_room';

DELETE FROM feature_flags
WHERE feature_key = 'live_room';

DELETE FROM user_feature_previews
WHERE feature_key = 'live_room';
