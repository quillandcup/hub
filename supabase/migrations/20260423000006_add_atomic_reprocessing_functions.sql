-- Add atomic reprocessing functions for Silver layer
-- These functions ensure DELETE + INSERT happens in a single transaction,
-- preventing users from seeing partial state during reprocessing

-- Function: Atomically reprocess prickles (calendar source) for a date range
CREATE OR REPLACE FUNCTION reprocess_prickles_atomic(
  from_date TIMESTAMPTZ,
  to_date TIMESTAMPTZ,
  new_data JSONB
) RETURNS void AS $$
BEGIN
  -- Single transaction: no partial date range visible
  -- Delete calendar prickles that overlap the date range
  -- Use overlap logic (start < rangeEnd AND end > rangeStart) to catch prickles
  -- that span across date boundaries
  DELETE FROM prickles
  WHERE start_time < to_date
    AND end_time > from_date
    AND source = 'calendar';

  -- Insert fresh prickles from new_data
  -- Expected JSONB format: array of objects with fields:
  -- type_id (uuid), title (text|null), host (uuid|null), start_time (timestamptz), end_time (timestamptz), source (text)
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

-- Function: Atomically reprocess prickle attendance for a date range
-- This function handles the complex case where:
-- 1. PUPs need to be created to get their IDs
-- 2. Attendance records reference either calendar prickles (pre-existing) OR new PUP IDs
-- We use client_prickle_id as a temporary identifier to link PUPs to attendance
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
  -- Expected new_pup_data format: array of objects with fields:
  -- client_prickle_id (text), type_id (uuid), host (uuid|null), start_time (timestamptz),
  -- end_time (timestamptz), source (text), zoom_meeting_uuid (text)
  -- Expected new_attendance_data format: array of objects with fields:
  -- prickle_id (uuid|null), client_prickle_id (text|null), member_id (uuid),
  -- join_time (timestamptz), leave_time (timestamptz), confidence_score (numeric)
  -- Note: Either prickle_id (for calendar prickles) OR client_prickle_id (for PUPs) must be set
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
  -- Create mapping from client_prickle_id to real prickle.id
  -- Join on zoom_meeting_uuid + start_time + end_time (unique per PUP segment)
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
  -- Insert attendance records
  -- If prickle_id is set, use it directly (calendar prickle)
  -- If client_prickle_id is set, resolve it via prickle_id_map (new PUP)
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
  LEFT JOIN prickle_id_map ON prickle_id_map.client_prickle_id = attendance.value->>'client_prickle_id'
  WHERE new_attendance_data != 'null'::jsonb AND jsonb_array_length(new_attendance_data) > 0;
END;
$$ LANGUAGE plpgsql;

-- Function: Atomically reprocess all members (full-table refresh)
CREATE OR REPLACE FUNCTION reprocess_members_atomic(
  new_data JSONB
) RETURNS void AS $$
BEGIN
  -- Single transaction: DELETE all members, then INSERT fresh data

  -- First, delete all member_name_aliases (they reference member_id which will change)
  DELETE FROM member_name_aliases
  WHERE id != '00000000-0000-0000-0000-000000000000';

  -- Then delete all members (this will generate new UUIDs on INSERT)
  DELETE FROM members
  WHERE id != '00000000-0000-0000-0000-000000000000';

  -- Insert fresh members from new_data
  -- Expected JSONB format: array of objects with fields:
  -- email (text), name (text), joined_at (date), status (text), plan (text|null),
  -- source (text), staff_role (text|null), user_id (uuid|null),
  -- kajabi_id (text|null), stripe_customer_id (text|null)
  INSERT INTO members (email, name, joined_at, status, plan, source, staff_role, user_id, kajabi_id, stripe_customer_id)
  SELECT
    value->>'email',
    value->>'name',
    (value->>'joined_at')::date,
    value->>'status',
    value->>'plan',
    value->>'source',
    value->>'staff_role',
    (value->>'user_id')::uuid,
    value->>'kajabi_id',
    value->>'stripe_customer_id'
  FROM jsonb_array_elements(new_data);
END;
$$ LANGUAGE plpgsql;

-- Add comment explaining the atomic pattern
COMMENT ON FUNCTION reprocess_prickles_atomic IS
'Atomically reprocess calendar prickles for a date range. DELETE + INSERT in single transaction prevents users from seeing partial state.';

COMMENT ON FUNCTION reprocess_prickle_attendance_atomic IS
'Atomically reprocess attendance and PUPs for a date range. DELETE + INSERT in single transaction prevents users from seeing partial state.';

COMMENT ON FUNCTION reprocess_members_atomic IS
'Atomically reprocess all members (full-table refresh). DELETE + INSERT in single transaction prevents users from seeing partial state.';
