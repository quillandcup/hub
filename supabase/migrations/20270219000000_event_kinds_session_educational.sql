-- Two more kinds of event, for the Events page's tiers: a "session" (a regular prickle that is featured:
-- the weekly or monthly FYI like Pitch Prickle or Monthly Goal Review) and "educational" (its own pillar of
-- the community: webinars and the like). Which kind an event gets when it is made from a prickle is a setting
-- of the prickle type (event_kind), an admin can change it on the event.

ALTER TABLE events DROP CONSTRAINT IF EXISTS events_event_type_check;
ALTER TABLE events ADD CONSTRAINT events_event_type_check
  CHECK (event_type IN ('in_person_retreat', 'virtual_retreat', 'workshop', 'book_launch', 'social', 'session', 'educational', 'other'));

ALTER TABLE prickle_types ADD COLUMN IF NOT EXISTS event_kind TEXT NOT NULL DEFAULT 'session';
ALTER TABLE prickle_types DROP CONSTRAINT IF EXISTS prickle_types_event_kind_check;
ALTER TABLE prickle_types ADD CONSTRAINT prickle_types_event_kind_check
  CHECK (event_kind IN ('in_person_retreat', 'virtual_retreat', 'workshop', 'book_launch', 'social', 'session', 'educational', 'other'));

COMMENT ON COLUMN prickle_types.event_kind IS 'The kind of event an event made from a prickle of this type starts as (events.event_type): session for a regular prickle, educational, social, a retreat... Admin-editable.';

UPDATE prickle_types SET event_kind = 'educational' WHERE normalized_name = 'educational';
UPDATE prickle_types SET event_kind = 'social' WHERE normalized_name IN ('qc-holiday-party', 'qc-birthday-party');
UPDATE prickle_types SET event_kind = 'virtual_retreat' WHERE normalized_name = 'virtual-retreat';

-- Events already made from a prickle, still the default kind, take their type's.
UPDATE events e
   SET event_type = t.event_kind
  FROM prickles p
  JOIN prickle_types t ON t.id = p.type_id
 WHERE p.calendar_event_id = e.calendar_event_id
   AND e.event_type = 'other';
