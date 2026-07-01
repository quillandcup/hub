-- Fix: zoom_meeting_uuid alone is not unique for PUPs.
-- One Zoom meeting produces multiple PUP segments (pre-prickle, post-prickle, gap segments),
-- each with a different (start_time, end_time). The correct natural key is the composite
-- (zoom_meeting_uuid, start_time, end_time).
--
-- Migration 20260630000002 created a single-column unique index which was wrong,
-- and the deduplication step deleted valid distinct segments for the same meeting.
-- This migration corrects both.

DROP INDEX IF EXISTS idx_prickles_zoom_meeting_uuid;

-- Deduplicate on the correct composite key before creating the index.
WITH keepers AS (
  SELECT DISTINCT ON (zoom_meeting_uuid, start_time, end_time) id AS keeper_id, zoom_meeting_uuid, start_time, end_time
  FROM prickles
  WHERE zoom_meeting_uuid IS NOT NULL
  ORDER BY zoom_meeting_uuid, start_time, end_time, id
)
UPDATE prickle_attendance pa
SET prickle_id = keepers.keeper_id
FROM prickles p
JOIN keepers
  ON keepers.zoom_meeting_uuid = p.zoom_meeting_uuid
 AND keepers.start_time = p.start_time
 AND keepers.end_time = p.end_time
WHERE pa.prickle_id = p.id
  AND p.id != keepers.keeper_id;

WITH keepers AS (
  SELECT DISTINCT ON (zoom_meeting_uuid, start_time, end_time) id AS keeper_id
  FROM prickles
  WHERE zoom_meeting_uuid IS NOT NULL
  ORDER BY zoom_meeting_uuid, start_time, end_time, id
)
DELETE FROM prickles p
WHERE zoom_meeting_uuid IS NOT NULL
  AND id NOT IN (SELECT keeper_id FROM keepers);

CREATE UNIQUE INDEX idx_prickles_zoom_meeting_uuid
  ON prickles(zoom_meeting_uuid, start_time, end_time)
  WHERE zoom_meeting_uuid IS NOT NULL;

-- Rewrite the atomic function to use the composite conflict key and
-- full (uuid, start, end) matching for orphan deletion and prickle_id_map.
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

  -- Delete PUPs in range with no matching (zoom_meeting_uuid, start_time, end_time)
  -- in the incoming data (includes deleted meetings and changed segment boundaries).
  DELETE FROM prickles
  WHERE source = 'zoom'
    AND start_time < to_date
    AND end_time > from_date
    AND (
      new_pup_data IS NULL
      OR new_pup_data = 'null'::jsonb
      OR jsonb_array_length(new_pup_data) = 0
      OR zoom_meeting_uuid IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(new_pup_data) nd
        WHERE nd.value->>'zoom_meeting_uuid' = prickles.zoom_meeting_uuid
          AND (nd.value->>'start_time')::timestamptz = prickles.start_time
          AND (nd.value->>'end_time')::timestamptz   = prickles.end_time
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
    ON CONFLICT (zoom_meeting_uuid, start_time, end_time) WHERE zoom_meeting_uuid IS NOT NULL DO UPDATE SET
      type_id = EXCLUDED.type_id,
      host    = EXCLUDED.host,
      source  = EXCLUDED.source
    RETURNING id, zoom_meeting_uuid, start_time, end_time
  ),
  prickle_id_map AS (
    SELECT
      value->>'client_prickle_id' AS client_prickle_id,
      upserted_pups.id AS prickle_id
    FROM jsonb_array_elements(new_pup_data)
    JOIN upserted_pups
      ON upserted_pups.zoom_meeting_uuid = value->>'zoom_meeting_uuid'
     AND upserted_pups.start_time = (value->>'start_time')::timestamptz
     AND upserted_pups.end_time   = (value->>'end_time')::timestamptz
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
    attendance.value->>'confidence_score'
  FROM jsonb_array_elements(new_attendance_data) AS attendance
  LEFT JOIN prickle_id_map
    ON prickle_id_map.client_prickle_id = attendance.value->>'client_prickle_id'
  WHERE new_attendance_data != 'null'::jsonb AND jsonb_array_length(new_attendance_data) > 0;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION reprocess_prickle_attendance_atomic(TIMESTAMPTZ, TIMESTAMPTZ, JSONB, JSONB)
  TO authenticated, service_role;
