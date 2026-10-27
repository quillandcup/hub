-- Who an event is for and how people join it, as separate fields rather than audience tiers:
-- announced_publicly (public marketing), guests_allowed (non-members may attend), how people
-- register, how many fit, and how places are given out. Nothing registers yet: these are what
-- the event page tells members. Also more kinds of event than retreats.

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS announced_publicly BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS guests_allowed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS registration TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS capacity INTEGER,
  ADD COLUMN IF NOT EXISTS selection TEXT NOT NULL DEFAULT 'first_come',
  ADD COLUMN IF NOT EXISTS speakers TEXT;

ALTER TABLE events DROP CONSTRAINT IF EXISTS events_registration_check;
ALTER TABLE events ADD CONSTRAINT events_registration_check CHECK (registration IN ('none', 'signup', 'application'));
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_selection_check;
ALTER TABLE events ADD CONSTRAINT events_selection_check CHECK (selection IN ('first_come', 'selected'));
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_capacity_check;
ALTER TABLE events ADD CONSTRAINT events_capacity_check CHECK (capacity IS NULL OR capacity > 0);

ALTER TABLE events DROP CONSTRAINT IF EXISTS events_event_type_check;
ALTER TABLE events ADD CONSTRAINT events_event_type_check
  CHECK (event_type IN ('in_person_retreat', 'virtual_retreat', 'webinar', 'workshop', 'book_launch', 'social', 'other'));

COMMENT ON COLUMN events.announced_publicly IS 'Included in public marketing. Not read by any public page yet.';
COMMENT ON COLUMN events.guests_allowed IS 'Non-members may attend.';
COMMENT ON COLUMN events.registration IS 'How people join: none (just show up), signup (put your name down), application (the hosts accept people).';
COMMENT ON COLUMN events.capacity IS 'How many places there are; null means unlimited.';
COMMENT ON COLUMN events.selection IS 'How places are given out when there is a limit: first_come (first come, first served) or selected (the hosts choose).';
COMMENT ON COLUMN events.speakers IS 'Guest speakers or presenters, free text.';
