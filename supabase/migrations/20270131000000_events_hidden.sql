-- An event an admin hid: members no longer see it in Events, search, or their calendar feed, and
-- the calendar sync does not bring it back. Soft delete (deleted_at) rather than a delete, since
-- the sync creates events for the calendar items of listed prickle types and would recreate a
-- deleted one on its next run. Clearing deleted_at restores it.

ALTER TABLE events ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

COMMENT ON COLUMN events.deleted_at IS 'When an admin hid the event from members; null means shown. The calendar sync leaves a hidden event hidden.';
