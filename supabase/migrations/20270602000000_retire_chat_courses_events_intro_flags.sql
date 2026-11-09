-- Chat, posting in chat, Courses, Events and the intro reminders are on for every member and the code no longer
-- checks their flags (#1143, deployed), so retire `chat`, `chat_posting`, `courses`, `events` and `intro_reminders`:
-- remove them from the admin registry, segment assignments and per-user preview lists (the same shape as the other
-- retired flags).

DELETE FROM feature_flag_segments
WHERE feature_key IN ('chat', 'chat_posting', 'courses', 'events', 'intro_reminders');

DELETE FROM feature_flags
WHERE feature_key IN ('chat', 'chat_posting', 'courses', 'events', 'intro_reminders');

DELETE FROM user_feature_previews
WHERE feature_key IN ('chat', 'chat_posting', 'courses', 'events', 'intro_reminders');
