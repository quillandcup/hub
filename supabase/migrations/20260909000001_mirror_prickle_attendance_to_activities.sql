-- Mirror prickle_attendance into member_activities as part of the same
-- atomic reprocess, so the mirror can never drift from the source of truth
-- (both DELETE+INSERT in one transaction, scoped to the same date window).
--
-- One member_activities row per (member_id, prickle_id), aggregated across
-- any leave/rejoin records for that prickle — prickle_attendance itself
-- keeps its full multi-row granularity untouched.
--
-- engagement_value = 10 preserves today's `pricklesLast30Days * 10` scoring
-- weight — computeMemberEngagementMetrics (lib/member-engagement.ts) is
-- being consolidated to read attendance from this mirror instead of
-- querying prickle_attendance directly, so the weight has to live here now.
--
-- Based on the function body as of 20260630000006_fix_confidence_score_cast.sql
-- (the latest full CREATE OR REPLACE before this one — stable PUP ids via
-- ON CONFLICT (zoom_meeting_uuid, start_time, end_time), and a conditional
-- DELETE that only removes prickles absent from the new data), with the
-- mirror appended and search_path pinned explicitly per
-- 20260807023835_harden_search_path_and_definer_grants.sql.
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

  -- Mirror into member_activities, same window as the deletes/inserts above.
  DELETE FROM member_activities
  WHERE source = 'prickle_attendance'
    AND occurred_at >= from_date
    AND occurred_at < to_date;

  INSERT INTO member_activities (member_id, activity_type, activity_category, title, actor_kind, related_id, engagement_value, duration_minutes, occurred_at, source)
  SELECT
    pa.member_id,
    'prickle_attended',
    'event',
    'Attended ' || COALESCE(pt.name, 'a Prickle'),
    'member',
    pa.prickle_id::text,
    10,
    (SUM(EXTRACT(EPOCH FROM (pa.leave_time - pa.join_time))) / 60)::int,
    MIN(pa.join_time),
    'prickle_attendance'
  FROM prickle_attendance pa
  JOIN prickles p ON p.id = pa.prickle_id
  LEFT JOIN prickle_types pt ON pt.id = p.type_id
  WHERE pa.join_time < to_date AND pa.leave_time > from_date
  GROUP BY pa.member_id, pa.prickle_id, pt.name;
END;
$$ LANGUAGE plpgsql SET search_path = 'public';

GRANT EXECUTE ON FUNCTION reprocess_prickle_attendance_atomic(TIMESTAMPTZ, TIMESTAMPTZ, JSONB, JSONB)
  TO authenticated, service_role;
