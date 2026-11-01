-- A webinar is an educational prickle (a prickle type listed in Events), not a kind of event.
-- Any event saved as a webinar becomes a plain event.

UPDATE events SET event_type = 'other' WHERE event_type = 'webinar';

ALTER TABLE events DROP CONSTRAINT IF EXISTS events_event_type_check;
ALTER TABLE events ADD CONSTRAINT events_event_type_check
  CHECK (event_type IN ('in_person_retreat', 'virtual_retreat', 'workshop', 'book_launch', 'social', 'other'));
