-- Drop-in check-ins go out for real to everyone. A member who joins the Zoom room of a prickle that started in the
-- last 18 minutes, without it on their calendar, is sent the check-in ("You're in ..."), so someone who joins without
-- a plan gets the check-in and the check-out as a pair, not the check-out alone. The flag stays: an admin turns it off
-- again from the feature flags admin UI if members push back on the volume (about 18 a day in the dry run), and the
-- members' own channel choices in Settings -> Notifications still apply. It was a dry run for everyone until now (no
-- row, so off): docs/CHECKIN_DELIVERY.md.
INSERT INTO feature_flags (feature_key, enabled_globally)
VALUES ('checkin_dropins', true)
ON CONFLICT (feature_key) DO UPDATE SET enabled_globally = true;
