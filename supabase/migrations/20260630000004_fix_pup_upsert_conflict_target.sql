-- Fix: ON CONFLICT (zoom_meeting_uuid) must include WHERE zoom_meeting_uuid IS NOT NULL
-- to match the partial unique index idx_prickles_zoom_meeting_uuid.

CREATE OR REPLACE FUNCTION reprocess_prickle_attendance_atomic(
  from_date TIMESTAMPTZ,
  to_date TIMESTAMPTZ,
  new_pup_data JSONB,
  new_attendance_data JSONB
) RETURNS void AS $$
BEGIN
  DELETE FROM prickle_attendance
  WHERE join_time < to_date
    AND leave_time > from_date;

  DELETE FROM prickles
  WHERE source = 'zoom'
    AND start_time < to_date
    AND end_time > from_date
    AND (
      new_pup_data IS NULL
      OR new_pup_data = 'null'::jsonb
      OR jsonb_array_length(new_pup_data) = 0
      OR zoom_meeting_uuid IS NULL
      OR zoom_meeting_uuid NOT IN (
        SELECT value->>'zoom_meeting_uuid'
        FROM jsonb_array_elements(new_pup_data)
        WHERE value->>'zoom_meeting_uuid' IS NOT NULL
      )
    );

  WITH upserted_pups AS (
    INSERT INTO prickles (type_id, host, start_time, end_time, source, zoom_meeting_uuid)
    SELECT
      (value->>'type_id')::uuid,
      (value->>'host')::uuid,
      (value->>'start_time')::timestamptz,
      (value->>'end_time')::timestamptz,
      value->>'source',
      value->>'zoom_meeting_uuid'
    FROM jsonb_array_elements(new_pup_data)
    WHERE new_pup_data != 'null'::jsonb AND jsonb_array_length(new_pup_data) > 0
    ON CONFLICT (zoom_meeting_uuid) WHERE zoom_meeting_uuid IS NOT NULL DO UPDATE SET
      type_id    = EXCLUDED.type_id,
      host       = EXCLUDED.host,
      start_time = EXCLUDED.start_time,
      end_time   = EXCLUDED.end_time,
      source     = EXCLUDED.source
    RETURNING id, zoom_meeting_uuid
  ),
  prickle_id_map AS (
    SELECT
      value->>'client_prickle_id' AS client_prickle_id,
      upserted_pups.id AS prickle_id
    FROM jsonb_array_elements(new_pup_data)
    JOIN upserted_pups ON upserted_pups.zoom_meeting_uuid = value->>'zoom_meeting_uuid'
    WHERE new_pup_data != 'null'::jsonb AND jsonb_array_length(new_pup_data) > 0
  )
  INSERT INTO prickle_attendance (member_id, prickle_id, join_time, leave_time, confidence_score)
  SELECT
    (attendance.value->>'member_id')::uuid,
    COALESCE(
      (attendance.value->>'prickle_id')::uuid,
      prickle_id_map.prickle_id
    ),
    (attendance.value->>'join_time')::timestamptz,
    (attendance.value->>'leave_time')::timestamptz,
    (attendance.value->>'confidence_score')::numeric
  FROM jsonb_array_elements(new_attendance_data) AS attendance
  LEFT JOIN prickle_id_map
    ON prickle_id_map.client_prickle_id = attendance.value->>'client_prickle_id'
  WHERE new_attendance_data != 'null'::jsonb AND jsonb_array_length(new_attendance_data) > 0;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION reprocess_prickle_attendance_atomic(TIMESTAMPTZ, TIMESTAMPTZ, JSONB, JSONB)
  TO authenticated, service_role;
