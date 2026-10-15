-- Universal search is now enabled for everyone. Remove the retired flag from
-- the admin registry, segment assignments, and per-user preview lists.

DELETE FROM feature_flag_segments
WHERE feature_key = 'universal_search';

DELETE FROM feature_flags
WHERE feature_key = 'universal_search';

DELETE FROM user_feature_previews
WHERE feature_key = 'universal_search';
