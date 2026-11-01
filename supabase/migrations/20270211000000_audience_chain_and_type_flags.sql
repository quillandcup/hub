-- Who may attend depends on how widely something is announced: guests only at something announced publicly,
-- and only something listed in Events is announced publicly. Enforced here for prickle types (listed in
-- Events -> announced publicly -> guests allowed) and for events (an event is listed by being an event:
-- announced publicly -> guests allowed), after setting the flags the community lead decided on.

-- Daydream Prickle has had no type of its own: its calendar items ("Q&C DAYDREAM PRICKLE w/...") were resolved,
-- by hand, to the nearest one (Pitch Prickle). The summary alias matches the calendar title once normalized.
INSERT INTO prickle_types (name, normalized_name, description, requires_host, purpose, summary_aliases)
VALUES (
  'Daydream Prickle',
  'daydream',
  'The stories you aren''t writing..._yet_. Share the books that live in your imagination.',
  true,
  'writing',
  ARRAY['qc-daydream']
)
ON CONFLICT (normalized_name) DO NOTHING;

-- The saved decisions for those calendar items now point at it, so the next reprocessing types them right.
UPDATE unmatched_calendar_events
   SET resolved_type_id = (SELECT id FROM prickle_types WHERE normalized_name = 'daydream')
 WHERE status = 'resolved'
   AND raw_summary ILIKE '%daydream%'
   AND EXISTS (SELECT 1 FROM prickle_types WHERE normalized_name = 'daydream');

-- Listed in Events and announced publicly, members only.
UPDATE prickle_types
   SET listed_in_events = true, announced_publicly = true, guests_allowed = false
 WHERE normalized_name IN (
   'quill-cup-challenge', 'pitch', 'open-mic', 'readers-club', 'hedgies-on-first',
   'monthly-goal-review', 'story-spill', 'qc-birthday-party', 'book-club', 'enneagram', 'daydream'
 );

-- Listed, announced publicly, and guests may come (an attendee at a book fair need not be a writer).
UPDATE prickle_types
   SET listed_in_events = true, announced_publicly = true, guests_allowed = true
 WHERE normalized_name IN ('free-writing-hour', 'book-fair');

-- Educational sessions are announced publicly, but most don't take guests; the few that do (with a sign-up)
-- allow them on the event, not by default for the type.
UPDATE prickle_types
   SET listed_in_events = true, announced_publicly = true, guests_allowed = false
 WHERE normalized_name = 'educational';

ALTER TABLE prickle_types DROP CONSTRAINT IF EXISTS prickle_types_audience_chain;
ALTER TABLE prickle_types ADD CONSTRAINT prickle_types_audience_chain
  CHECK ((NOT announced_publicly OR listed_in_events) AND (NOT guests_allowed OR announced_publicly));

ALTER TABLE events DROP CONSTRAINT IF EXISTS events_audience_chain;
ALTER TABLE events ADD CONSTRAINT events_audience_chain CHECK (NOT guests_allowed OR announced_publicly);

COMMENT ON CONSTRAINT prickle_types_audience_chain ON prickle_types IS 'Announced publicly needs listed in Events; guests allowed needs announced publicly.';
COMMENT ON CONSTRAINT events_audience_chain ON events IS 'Guests allowed needs announced publicly.';
