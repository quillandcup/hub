-- Events the calendar sync made by itself (a prickle type listed in Events, or #event in the Google
-- Calendar description), as opposed to ones an admin made or kept. The sync takes an automatic event
-- away again when its reason stops applying (the tag is removed, the type is un-listed, the calendar
-- item is deleted). An admin who edits one, or shows it by hand, keeps it: automatic becomes false.

ALTER TABLE events ADD COLUMN IF NOT EXISTS automatic BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN events.automatic IS 'Made by the calendar sync from a rule (listed prickle type or #event); the sync removes it when the rule stops applying. False once an admin has edited or kept it, and for events made in the Hub.';
