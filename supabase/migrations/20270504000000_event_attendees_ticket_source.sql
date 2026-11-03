-- How an attendee got in. A comped, gifted or donated ticket leaves no purchase behind, so
-- until now the only way to tell a comped attendee from a missing one was someone's old notes
-- (a comped summer retreat attendee had no badge because nothing showed she was expected).
--
-- Both columns are nullable: null means "not recorded", which is every existing row.
-- add_event_attendee() is untouched (its signature can't change without a drop); the admin
-- route sets these right after it.

set lock_timeout = '5s';

ALTER TABLE event_attendees
  ADD COLUMN ticket_source TEXT CHECK (ticket_source IN ('purchased', 'comped', 'gifted', 'donated')),
  ADD COLUMN ticket_note TEXT;

COMMENT ON COLUMN event_attendees.ticket_source IS
  'How the attendee got in: purchased, comped (given by us), gifted (another member paid), donated (from the donated-ticket pool). NULL = not recorded.';
COMMENT ON COLUMN event_attendees.ticket_note IS
  'Free text about the ticket, e.g. who gifted it or why it was comped. Staff only; never shown to members.';
