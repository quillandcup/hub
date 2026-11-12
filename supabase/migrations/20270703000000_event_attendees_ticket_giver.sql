-- Who gave a gifted attendee their ticket, as a link instead of only free text in ticket_note.
-- With it, "Find Kajabi matches" can tell that a buyer's ticket went to someone else.
-- Expand only: a new nullable column; nothing existing changes.

set lock_timeout = '5s';

ALTER TABLE event_attendees
  ADD COLUMN ticket_giver_id TEXT REFERENCES members(id) ON DELETE SET NULL;

CREATE INDEX event_attendees_ticket_giver_id_idx ON event_attendees (ticket_giver_id) WHERE ticket_giver_id IS NOT NULL;

COMMENT ON COLUMN event_attendees.ticket_giver_id IS
  'The member who gave this attendee their ticket. Only meaningful with ticket_source = gifted; the free-text ticket_note keeps the reason. Deleting the giver clears the link and keeps the attendee. Staff only.';

INSERT INTO public.member_data_handling (table_name, column_name, action, why)
VALUES ('event_attendees', 'ticket_giver_id', 'null', 'who gave an attendee their ticket: the attendee keeps the row and loses the link');
