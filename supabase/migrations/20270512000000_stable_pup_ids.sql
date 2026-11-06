-- Stable Pop-Up Prickle ids: keep a PUP's id when only its end moves.
--
-- reprocess_prickle_attendance_atomic keyed a PUP on (zoom_meeting_uuid, start_time, end_time), so a
-- run that computed a different end deleted the row and inserted a new one: a new id, and every
-- table that references prickles with ON DELETE CASCADE (prickle_checkins, both dismissal tables,
-- prickle_checkin_dm_log, calendar_feed_items, ignored_zoom_appearances, prickle_popularity,
-- prickle_attendance) lost its rows, so a member could be sent the same check-out again and lose
-- saved answers. This is the latest definition (20261215000000_short_ids_tier1.sql) with one added
-- step at the top, which moves the end of the row with the same meeting and start in place.
-- Same signature, so the code live during the deploy keeps working. docs/TODO.md, "Pop-Up Prickle
-- ids change while a meeting is still running...".

set lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.reprocess_prickle_attendance_atomic(from_date timestamp with time zone, to_date timestamp with time zone, new_pup_data jsonb, new_attendance_data jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
BEGIN
  -- Keep a Pop-Up Prickle's id when only its end moves. A PUP is keyed on (meeting, start, end), so a
  -- run that computes a different end (a member newly matched to an earlier or later joiner, say)
  -- used to delete the row and insert a new one: a new id, with the old one's check-ins, dismissals,
  -- DM log, calendar items and attendance cascaded away (and logged progress and activities left
  -- unlinked). The row of the same meeting and start gets the new end in place instead, so the delete
  -- below leaves it and the upsert finds it. Only when the incoming PUPs name that start once and
  -- the meeting has one row for it, so it can't collide with the unique index on the new end.
  IF jsonb_typeof(new_pup_data) = 'array' AND jsonb_array_length(new_pup_data) > 0 THEN
    UPDATE prickles p
    SET end_time = nd.end_time
    FROM (
      SELECT
        value->>'zoom_meeting_uuid' AS zoom_meeting_uuid,
        (value->>'start_time')::timestamptz AS start_time,
        (value->>'end_time')::timestamptz AS end_time
      FROM jsonb_array_elements(new_pup_data)
    ) nd
    WHERE p.source = 'zoom'
      AND p.zoom_meeting_uuid = nd.zoom_meeting_uuid
      AND p.start_time = nd.start_time
      AND p.end_time <> nd.end_time
      AND p.start_time < to_date
      AND GREATEST(p.end_time, nd.end_time) > from_date
      AND (
        SELECT count(*) FROM jsonb_array_elements(new_pup_data) x
        WHERE x.value->>'zoom_meeting_uuid' = nd.zoom_meeting_uuid
          AND (x.value->>'start_time')::timestamptz = nd.start_time
      ) = 1
      AND NOT EXISTS (
        SELECT 1 FROM prickles q
        WHERE q.id <> p.id AND q.zoom_meeting_uuid = p.zoom_meeting_uuid AND q.start_time = p.start_time
      );
  END IF;

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
      (value->>'type_id'),
      (value->>'host'),
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
    (attendance.value->>'member_id'),
    COALESCE(
      (attendance.value->>'prickle_id'),
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
$function$;
