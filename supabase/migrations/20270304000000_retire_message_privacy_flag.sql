-- The /privacy page is on for every member, so retire the `message_privacy` flag: remove it from the admin
-- registry, segment assignments and per-user preview lists (the same shape as the other retired flags).

DELETE FROM feature_flag_segments
WHERE feature_key = 'message_privacy';

DELETE FROM feature_flags
WHERE feature_key = 'message_privacy';

DELETE FROM user_feature_previews
WHERE feature_key = 'message_privacy';
