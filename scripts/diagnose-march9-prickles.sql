-- Diagnose March 9, 2026 prickle and segmentation issues
-- Run this against production database

-- 1. Check all calendar events on March 9
SELECT
  id,
  summary,
  start_time AT TIME ZONE 'America/New_York' as start_et,
  end_time AT TIME ZONE 'America/New_York' as end_et,
  source,
  google_event_id
FROM calendar_events
WHERE start_time::date = '2026-03-09'
ORDER BY start_time;

-- 2. Check all prickles created on March 9
SELECT
  p.id,
  pt.name as type,
  p.start_time AT TIME ZONE 'America/New_York' as start_et,
  p.end_time AT TIME ZONE 'America/New_York' as end_et,
  p.source,
  p.zoom_meeting_uuid,
  (SELECT COUNT(*) FROM attendance WHERE prickle_id = p.id) as attendee_count
FROM prickles p
JOIN prickle_types pt ON p.type_id = pt.id
WHERE p.start_time::date = '2026-03-09'
ORDER BY p.start_time;

-- 3. Check the specific Sprint Prickle in question
SELECT
  p.id,
  pt.name as type,
  p.start_time AT TIME ZONE 'America/New_York' as start_et,
  p.end_time AT TIME ZONE 'America/New_York' as end_et,
  p.source,
  p.zoom_meeting_uuid
FROM prickles p
JOIN prickle_types pt ON p.type_id = pt.id
WHERE p.id = '4a4b58405-2aa7-40d2-b759-d31f8bf68414';

-- 4. Check attendance for that Sprint Prickle
SELECT
  m.name as member,
  a.join_time AT TIME ZONE 'America/New_York' as join_et,
  a.leave_time AT TIME ZONE 'America/New_York' as leave_et,
  EXTRACT(EPOCH FROM (a.leave_time - a.join_time))/60 as duration_min
FROM attendance a
JOIN members m ON a.member_id = m.id
WHERE a.prickle_id = '4a4b58405-2aa7-40d2-b759-d31f8bf68414'
ORDER BY a.join_time;

-- 5. Check if there are Zoom meetings around that time
SELECT
  meeting_uuid,
  MIN(join_time) AT TIME ZONE 'America/New_York' as first_join_et,
  MAX(leave_time) AT TIME ZONE 'America/New_York' as last_leave_et,
  COUNT(DISTINCT name) as unique_attendees,
  COUNT(*) as total_records
FROM zoom_attendees
WHERE join_time::date = '2026-03-09'
  AND join_time AT TIME ZONE 'America/New_York' BETWEEN '2026-03-09 13:00:00' AND '2026-03-09 15:30:00'
GROUP BY meeting_uuid
ORDER BY first_join_et;

-- 6. Check for overlapping calendar prickles around 2-3pm
SELECT
  p.id,
  pt.name as type,
  p.start_time AT TIME ZONE 'America/New_York' as start_et,
  p.end_time AT TIME ZONE 'America/New_York' as end_et,
  p.source
FROM prickles p
JOIN prickle_types pt ON p.type_id = pt.id
WHERE p.source = 'calendar'
  AND p.start_time < '2026-03-09 15:00:00-05'  -- before 3pm ET
  AND p.end_time > '2026-03-09 14:00:00-05'    -- after 2pm ET
ORDER BY p.start_time;
