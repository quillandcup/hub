-- Add atomic reprocessing function for calendar prickles
-- This function ensures DELETE + INSERT happens in a single transaction,
-- preventing users from seeing partial state during reprocessing
-- Atomically reprocess calendar prickles for a date range.
-- DELETE + INSERT in single transaction prevents users from seeing partial state.

CREATE OR REPLACE FUNCTION reprocess_prickles_atomic(
  from_date TIMESTAMPTZ,
  to_date TIMESTAMPTZ,
  new_data JSONB
) RETURNS void AS $$
BEGIN
  -- Single transaction: no partial date range visible
  -- Delete calendar prickles that overlap the date range
  DELETE FROM prickles
  WHERE start_time < to_date
    AND end_time > from_date
    AND source = 'calendar';

  -- Insert fresh prickles from new_data
  INSERT INTO prickles (type_id, title, host, start_time, end_time, source)
  SELECT
    (value->>'type_id')::uuid,
    value->>'title',
    (value->>'host')::uuid,
    (value->>'start_time')::timestamptz,
    (value->>'end_time')::timestamptz,
    value->>'source'
  FROM jsonb_array_elements(new_data);
END;
$$ LANGUAGE plpgsql;
