-- Add atomic reprocessing function for prickle attendance and PUPs
-- This function ensures DELETE + INSERT happens in a single transaction,
-- preventing users from seeing partial state during reprocessing
-- Atomically reprocess attendance and PUPs for a date range.
-- DELETE + INSERT in single transaction prevents users from seeing partial state.

CREATE OR REPLACE FUNCTION reprocess_prickle_attendance_atomic(
  from_date TIMESTAMPTZ,
  to_date TIMESTAMPTZ,
  new_pup_data JSONB,
  new_attendance_data JSONB
) RETURNS void AS $$
BEGIN
  -- Single transaction: DELETE both PUPs and attendance, then INSERT fresh data

  -- Delete existing attendance records that overlap this date range
  DELETE FROM prickle_attendance
  WHERE join_time < to_date
    AND leave_time > from_date;

  -- Delete existing Pop-Up Prickles that overlap this date range
  DELETE FROM prickles
  WHERE source = 'zoom'
    AND start_time < to_date
    AND end_time > from_date;

  -- Insert fresh PUPs and attendance using CTE to map client-side IDs to real IDs
  WITH inserted_pups AS (
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
    RETURNING id, zoom_meeting_uuid, start_time, end_time
  ),
  prickle_id_map AS (
    SELECT
      value->>'client_prickle_id' as client_prickle_id,
      inserted_pups.id as prickle_id
    FROM jsonb_array_elements(new_pup_data),
         inserted_pups
    WHERE new_pup_data != 'null'::jsonb
      AND jsonb_array_length(new_pup_data) > 0
      AND inserted_pups.zoom_meeting_uuid = value->>'zoom_meeting_uuid'
      AND inserted_pups.start_time = (value->>'start_time')::timestamptz
      AND inserted_pups.end_time = (value->>'end_time')::timestamptz
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
    attendance.value->>'confidence_score'
  FROM jsonb_array_elements(new_attendance_data) AS attendance
  LEFT JOIN prickle_id_map ON prickle_id_map.client_prickle_id = attendance.value->>'client_prickle_id'
  WHERE new_attendance_data != 'null'::jsonb AND jsonb_array_length(new_attendance_data) > 0;
END;
$$ LANGUAGE plpgsql;
