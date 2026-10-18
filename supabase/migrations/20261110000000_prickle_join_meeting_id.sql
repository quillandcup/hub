-- The Zoom meeting ID shown beside the passcode (for people who join by typing it in rather than
-- the one-click link). Nullable: settings saved before this have none.
ALTER TABLE prickle_join_settings ADD COLUMN meeting_id TEXT;
