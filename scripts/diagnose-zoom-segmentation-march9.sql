-- Diagnose Zoom meeting segmentation for March 9 Sprint Prickle
-- Check if there were multiple Zoom meetings or one meeting with leave/rejoin

-- 1. Find all Zoom attendee records for people in that Sprint Prickle around 2-3pm ET
SELECT
  za.meeting_uuid,
  za.name,
  za.email,
  za.join_time AT TIME ZONE 'America/New_York' as join_et,
  za.leave_time AT TIME ZONE 'America/New_York' as leave_et,
  EXTRACT(EPOCH FROM (za.leave_time - za.join_time))/60 as duration_min
FROM zoom_attendees za
WHERE za.join_time::date = '2026-03-09'
  AND za.join_time AT TIME ZONE 'America/New_York' >= '2026-03-09 14:00:00'  -- 2pm ET
  AND za.join_time AT TIME ZONE 'America/New_York' < '2026-03-09 15:30:00'   -- 3:30pm ET
ORDER BY za.meeting_uuid, za.join_time;

-- 2. Group by meeting UUID to see meeting boundaries
SELECT
  meeting_uuid,
  MIN(join_time) AT TIME ZONE 'America/New_York' as meeting_start_et,
  MAX(leave_time) AT TIME ZONE 'America/New_York' as meeting_end_et,
  COUNT(DISTINCT name) as unique_attendees,
  COUNT(*) as total_records,
  STRING_AGG(DISTINCT name, ', ' ORDER BY name) as attendees
FROM zoom_attendees
WHERE join_time::date = '2026-03-09'
  AND join_time AT TIME ZONE 'America/New_York' >= '2026-03-09 14:00:00'
  AND join_time AT TIME ZONE 'America/New_York' < '2026-03-09 15:30:00'
GROUP BY meeting_uuid
ORDER BY meeting_start_et;

-- 3. Check what prickles were matched to those Zoom meetings
SELECT
  p.zoom_meeting_uuid,
  pt.name as prickle_type,
  p.start_time AT TIME ZONE 'America/New_York' as prickle_start_et,
  p.end_time AT TIME ZONE 'America/New_York' as prickle_end_et,
  p.source,
  (SELECT COUNT(*) FROM attendance WHERE prickle_id = p.id) as attendee_count
FROM prickles p
JOIN prickle_types pt ON p.type_id = pt.id
WHERE p.zoom_meeting_uuid IN (
  SELECT DISTINCT meeting_uuid
  FROM zoom_attendees
  WHERE join_time::date = '2026-03-09'
    AND join_time AT TIME ZONE 'America/New_York' >= '2026-03-09 14:00:00'
    AND join_time AT TIME ZONE 'America/New_York' < '2026-03-09 15:30:00'
)
ORDER BY p.start_time;

-- 4. Check the specific Sprint Prickle's Zoom meeting UUID
SELECT
  p.id,
  p.zoom_meeting_uuid,
  pt.name as type,
  p.start_time AT TIME ZONE 'America/New_York' as start_et,
  p.end_time AT TIME ZONE 'America/New_York' as end_et,
  p.source
FROM prickles p
JOIN prickle_types pt ON p.type_id = pt.id
WHERE p.id = '4a4b58405-2aa7-40d2-b759-d31f8bf68414';

-- 5. If it has a Zoom UUID, show all Zoom records for that meeting
SELECT
  za.name,
  za.email,
  za.join_time AT TIME ZONE 'America/New_York' as join_et,
  za.leave_time AT TIME ZONE 'America/New_York' as leave_et,
  EXTRACT(EPOCH FROM (za.leave_time - za.join_time))/60 as duration_min
FROM zoom_attendees za
WHERE za.meeting_uuid = (
  SELECT zoom_meeting_uuid
  FROM prickles
  WHERE id = '4a4b58405-2aa7-40d2-b759-d31f8bf68414'
)
ORDER BY za.join_time;

-- 6. Check for overlapping calendar prickles that might have split the meeting
SELECT
  p.id,
  pt.name as type,
  p.start_time AT TIME ZONE 'America/New_York' as start_et,
  p.end_time AT TIME ZONE 'America/New_York' as end_et,
  p.source,
  p.zoom_meeting_uuid
FROM prickles p
JOIN prickle_types pt ON p.type_id = pt.id
WHERE p.source = 'calendar'
  AND p.start_time < '2026-03-09 15:00:00-05'::timestamptz  -- before 3pm ET
  AND p.end_time > '2026-03-09 14:00:00-05'::timestamptz    -- after 2pm ET
ORDER BY p.start_time;
