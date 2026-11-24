-- A third ticket source, transferred: the attendee's ticket was bought for another event and moved to this one.
-- ticket_from_event_id is that origin event; the origin side is derived from it, nothing is stored there.
-- Expand only for the column; the source check is replaced (see below).

set lock_timeout = '5s';

ALTER TABLE event_attendees
  ADD COLUMN ticket_from_event_id TEXT REFERENCES community_events(id) ON DELETE SET NULL;

CREATE INDEX event_attendees_ticket_from_event_id_idx ON event_attendees (ticket_from_event_id) WHERE ticket_from_event_id IS NOT NULL;

COMMENT ON COLUMN event_attendees.ticket_from_event_id IS
  'The event this attendee''s ticket was bought for, when it was moved to this one. Only meaningful with ticket_source = transferred, and no CHECK ties them: the link is ON DELETE SET NULL, so deleting the origin event clears it and keeps the attendee, and the app requires an origin when the source is set. The origin event reads it to say a buyer''s ticket moved. Staff only.';

-- Approved ban-drop-constraint ignore: the owner approved replacing event_attendees_ticket_source_check on 2026-11-24; it only adds 'transferred' and drops 'purchased' and 'donated', which no row holds.
-- squawk-ignore ban-drop-constraint
ALTER TABLE event_attendees DROP CONSTRAINT event_attendees_ticket_source_check;

ALTER TABLE event_attendees
  ADD CONSTRAINT event_attendees_ticket_source_check CHECK (ticket_source IN ('comped', 'gifted', 'transferred')) NOT VALID;

ALTER TABLE event_attendees VALIDATE CONSTRAINT event_attendees_ticket_source_check;
