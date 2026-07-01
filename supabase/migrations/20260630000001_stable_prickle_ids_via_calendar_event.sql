-- Give calendar prickles stable IDs so reprocessing doesn't break links or attendance FKs.
--
-- Previously, reprocess_prickles_atomic did DELETE + INSERT, producing new UUIDs every time.
-- This broke /admin/prickles/<id> URLs and invalidated prickle_attendance foreign keys.
--
-- Fix: store calendar_event_id on prickles and UPSERT on it so existing prickle UUIDs
-- survive reprocessing. Only true orphans (calendar events deleted upstream) are removed.

ALTER TABLE prickles
  ADD COLUMN calendar_event_id UUID REFERENCES bronze.calendar_events(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX idx_prickles_calendar_event_id
  ON prickles(calendar_event_id)
  WHERE calendar_event_id IS NOT NULL;

-- Backfill existing calendar prickles by matching start_time + end_time.
-- One prickle per calendar event (ROW_NUMBER picks one when duplicates exist).
-- Unmatched and losing duplicates keep calendar_event_id = NULL and are removed
-- by the DELETE-orphans step on the next calendar reprocess.
WITH ranked AS (
  SELECT
    p.id  AS prickle_id,
    ce.id AS event_id,
    ROW_NUMBER() OVER (PARTITION BY ce.id ORDER BY p.id) AS rn
  FROM prickles p
  JOIN bronze.calendar_events ce
    ON p.start_time = ce.start_time
   AND p.end_time   = ce.end_time
  WHERE p.source = 'calendar'
    AND p.calendar_event_id IS NULL
)
UPDATE prickles p
SET calendar_event_id = ranked.event_id
FROM ranked
WHERE p.id = ranked.prickle_id
  AND ranked.rn = 1;

-- Replace the atomic function: DELETE orphans + UPSERT (preserves existing prickle UUIDs)
CREATE OR REPLACE FUNCTION reprocess_prickles_atomic(
  from_date TIMESTAMPTZ,
  to_date TIMESTAMPTZ,
  new_data JSONB
) RETURNS void AS $$
BEGIN
  -- Remove calendar prickles in range whose source calendar event no longer exists
  -- (calendar_event_id not in the incoming set = true orphan or legacy null-id row)
  DELETE FROM prickles
  WHERE source = 'calendar'
    AND start_time < to_date
    AND end_time > from_date
    AND (
      calendar_event_id IS NULL
      OR calendar_event_id NOT IN (
        SELECT (value->>'calendar_event_id')::uuid
        FROM jsonb_array_elements(new_data)
        WHERE value->>'calendar_event_id' IS NOT NULL
      )
    );

  -- UPSERT: existing prickles are updated in-place (UUID preserved), new ones are inserted
  INSERT INTO prickles (calendar_event_id, type_id, title, host, start_time, end_time, source)
  SELECT
    (value->>'calendar_event_id')::uuid,
    (value->>'type_id')::uuid,
    value->>'title',
    (value->>'host')::uuid,
    (value->>'start_time')::timestamptz,
    (value->>'end_time')::timestamptz,
    value->>'source'
  FROM jsonb_array_elements(new_data)
  ON CONFLICT (calendar_event_id) DO UPDATE SET
    type_id    = EXCLUDED.type_id,
    title      = EXCLUDED.title,
    host       = EXCLUDED.host,
    start_time = EXCLUDED.start_time,
    end_time   = EXCLUDED.end_time,
    source     = EXCLUDED.source;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION reprocess_prickles_atomic(TIMESTAMPTZ, TIMESTAMPTZ, JSONB)
  TO authenticated, service_role;
