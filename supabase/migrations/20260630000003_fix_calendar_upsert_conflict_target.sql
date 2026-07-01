-- Fix: ON CONFLICT must include the WHERE predicate to match a partial unique index.
-- Without it, Postgres can't find the index and raises
-- "there is no unique or exclusion constraint matching the ON CONFLICT specification".

CREATE OR REPLACE FUNCTION reprocess_prickles_atomic(
  from_date TIMESTAMPTZ,
  to_date TIMESTAMPTZ,
  new_data JSONB
) RETURNS void AS $$
BEGIN
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
  ON CONFLICT (calendar_event_id) WHERE calendar_event_id IS NOT NULL DO UPDATE SET
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
