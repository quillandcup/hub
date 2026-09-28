-- "Just this one" calendar items reference the prickle itself (prickle_id), not type + start time.
--
-- 20260928000100 identified a single prickle by type + start instant on the belief that prickle ids
-- change on reprocessing. They don't: since 20260630000001/2, calendar prickles upsert on
-- calendar_event_id and PUPs on zoom_meeting_uuid, so a prickle keeps its id (and its
-- /prickles/<id> URL) until its source calendar event or Zoom meeting is deleted. Referencing the
-- id follows a rescheduled prickle, and ON DELETE CASCADE drops the item with a cancelled one.

ALTER TABLE calendar_feed_items ADD COLUMN prickle_id UUID REFERENCES prickles(id) ON DELETE CASCADE;

-- Existing 'prickle' items: point at the prickle they were added from (exact type + start), and
-- drop any whose prickle is gone.
UPDATE calendar_feed_items i
SET prickle_id = p.id
FROM prickles p
WHERE i.kind = 'prickle'
  AND p.type_id = i.type_id
  AND p.start_time = i.start_time;

DELETE FROM calendar_feed_items WHERE kind = 'prickle' AND prickle_id IS NULL;

UPDATE calendar_feed_items SET type_id = NULL, start_time = NULL WHERE kind = 'prickle';

ALTER TABLE calendar_feed_items DROP CONSTRAINT calendar_feed_items_check;
DROP INDEX IF EXISTS uq_calendar_feed_items_prickle;
ALTER TABLE calendar_feed_items DROP COLUMN start_time;

ALTER TABLE calendar_feed_items ADD CONSTRAINT calendar_feed_items_check CHECK (
  CASE kind
    WHEN 'prickle' THEN prickle_id IS NOT NULL
      AND type_id IS NULL AND day_of_week IS NULL AND start_time_local IS NULL AND timezone IS NULL AND event_id IS NULL
    WHEN 'slot' THEN type_id IS NOT NULL AND day_of_week IS NOT NULL AND start_time_local IS NOT NULL AND timezone IS NOT NULL
      AND prickle_id IS NULL AND event_id IS NULL
    WHEN 'event' THEN event_id IS NOT NULL
      AND prickle_id IS NULL AND type_id IS NULL AND day_of_week IS NULL AND start_time_local IS NULL AND timezone IS NULL
  END
);

CREATE UNIQUE INDEX uq_calendar_feed_items_prickle
  ON calendar_feed_items(member_id, prickle_id) WHERE kind = 'prickle';
CREATE INDEX idx_calendar_feed_items_prickle_id ON calendar_feed_items(prickle_id);

COMMENT ON TABLE calendar_feed_items IS
  'LOCAL: prickles (one prickle via prickle_id, or a weekly slot) and events a member added to
   their personal calendar feed, on top of the hosted and committed prickles it includes
   automatically. Slots are type + weekday + wall-clock time in the schedule''s timezone.';
