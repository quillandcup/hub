-- Diagnostic queries to understand orphaned Zoom meetings issue
-- Run these in Supabase SQL Editor (Dashboard > SQL Editor)

-- ============================================================================
-- QUERY 1: Find meetings with multiple PUPs (potential duplicates from broken DELETE)
-- ============================================================================
SELECT
  zoom_meeting_uuid,
  COUNT(*) as pup_count,
  ARRAY_AGG(id ORDER BY start_time) as pup_ids,
  ARRAY_AGG(start_time || ' to ' || end_time ORDER BY start_time) as time_ranges
FROM prickles
WHERE source = 'zoom'
  AND zoom_meeting_uuid IS NOT NULL
GROUP BY zoom_meeting_uuid
HAVING COUNT(*) > 1
ORDER BY pup_count DESC
LIMIT 20;

-- ============================================================================
-- QUERY 2: Find PUPs that overlap in time (shouldn't exist with proper DELETE)
-- ============================================================================
WITH pup_overlaps AS (
  SELECT
    p1.id as pup1_id,
    p1.start_time as pup1_start,
    p1.end_time as pup1_end,
    p1.zoom_meeting_uuid as pup1_meeting,
    p2.id as pup2_id,
    p2.start_time as pup2_start,
    p2.end_time as pup2_end,
    p2.zoom_meeting_uuid as pup2_meeting
  FROM prickles p1
  JOIN prickles p2 ON p1.id < p2.id  -- Avoid duplicates
  WHERE p1.source = 'zoom'
    AND p2.source = 'zoom'
    -- Check for time overlap: p1.start < p2.end AND p1.end > p2.start
    AND p1.start_time < p2.end_time
    AND p1.end_time > p2.start_time
)
SELECT * FROM pup_overlaps
ORDER BY pup1_start
LIMIT 20;

-- ============================================================================
-- QUERY 3: Find attendance records without corresponding prickles
-- (indicates DELETE removed prickle but not attendance)
-- ============================================================================
SELECT
  a.id as attendance_id,
  a.prickle_id,
  a.member_id,
  a.join_time,
  a.leave_time,
  m.name as member_name
FROM attendance a
LEFT JOIN prickles p ON a.prickle_id = p.id
LEFT JOIN members m ON a.member_id = m.id
WHERE p.id IS NULL
ORDER BY a.join_time DESC
LIMIT 20;

-- ============================================================================
-- QUERY 4: Find PUPs with 0 attendance records
-- (indicates we created PUP but no attendees matched)
-- ============================================================================
SELECT
  p.id,
  p.start_time,
  p.end_time,
  p.zoom_meeting_uuid,
  p.created_at
FROM prickles p
LEFT JOIN attendance a ON p.id = a.prickle_id
WHERE p.source = 'zoom'
  AND a.id IS NULL
ORDER BY p.start_time DESC
LIMIT 20;

-- ============================================================================
-- QUERY 5: Compare meeting time windows (all attendees vs processed attendees)
-- This shows if we're processing partial meeting ranges
-- ============================================================================
WITH meeting_windows AS (
  SELECT
    meeting_uuid,
    MIN(join_time) as earliest_join,
    MAX(leave_time) as latest_leave,
    COUNT(DISTINCT id) as attendee_count
  FROM zoom_attendees
  WHERE meeting_uuid IS NOT NULL
  GROUP BY meeting_uuid
),
pup_windows AS (
  SELECT
    zoom_meeting_uuid as meeting_uuid,
    MIN(start_time) as pup_start,
    MAX(end_time) as pup_end,
    COUNT(*) as pup_count
  FROM prickles
  WHERE source = 'zoom'
    AND zoom_meeting_uuid IS NOT NULL
  GROUP BY zoom_meeting_uuid
)
SELECT
  mw.meeting_uuid,
  mw.earliest_join,
  mw.latest_leave,
  mw.attendee_count,
  pw.pup_start,
  pw.pup_end,
  pw.pup_count,
  -- Calculate time difference (PUP should match meeting window)
  EXTRACT(EPOCH FROM (mw.earliest_join - pw.pup_start)) / 60 as start_diff_minutes,
  EXTRACT(EPOCH FROM (pw.pup_end - mw.latest_leave)) / 60 as end_diff_minutes
FROM meeting_windows mw
LEFT JOIN pup_windows pw ON mw.meeting_uuid = pw.meeting_uuid
WHERE pw.meeting_uuid IS NOT NULL
  AND (
    -- Check for significant time differences (>5 minutes)
    ABS(EXTRACT(EPOCH FROM (mw.earliest_join - pw.pup_start))) > 300
    OR ABS(EXTRACT(EPOCH FROM (pw.pup_end - mw.latest_leave))) > 300
  )
ORDER BY mw.earliest_join DESC
LIMIT 20;

-- ============================================================================
-- QUERY 6: Find "orphaned" meetings (no PUP and no calendar overlap)
-- This replicates the hygiene dashboard logic
-- ============================================================================
WITH meeting_windows AS (
  SELECT
    meeting_uuid,
    MIN(join_time) as meeting_start,
    MAX(leave_time) as meeting_end
  FROM zoom_attendees
  WHERE meeting_uuid IS NOT NULL
  GROUP BY meeting_uuid
),
meetings_with_pups AS (
  SELECT DISTINCT zoom_meeting_uuid as meeting_uuid
  FROM prickles
  WHERE source = 'zoom'
    AND zoom_meeting_uuid IS NOT NULL
),
meetings_overlapping_calendar AS (
  SELECT DISTINCT mw.meeting_uuid
  FROM meeting_windows mw
  JOIN prickles p ON p.source = 'calendar'
    AND p.start_time < mw.meeting_end
    AND p.end_time > mw.meeting_start
)
SELECT
  mw.meeting_uuid,
  mw.meeting_start,
  mw.meeting_end,
  CASE
    WHEN mp.meeting_uuid IS NOT NULL THEN 'Has PUP'
    WHEN mc.meeting_uuid IS NOT NULL THEN 'Overlaps Calendar'
    ELSE 'ORPHANED'
  END as status
FROM meeting_windows mw
LEFT JOIN meetings_with_pups mp ON mw.meeting_uuid = mp.meeting_uuid
LEFT JOIN meetings_overlapping_calendar mc ON mw.meeting_uuid = mc.meeting_uuid
WHERE mp.meeting_uuid IS NULL
  AND mc.meeting_uuid IS NULL
ORDER BY mw.meeting_start DESC
LIMIT 50;

-- ============================================================================
-- SUMMARY STATS
-- ============================================================================
SELECT
  'Total Zoom Meetings' as metric,
  COUNT(DISTINCT meeting_uuid) as count
FROM zoom_attendees
WHERE meeting_uuid IS NOT NULL

UNION ALL

SELECT
  'Total PUPs' as metric,
  COUNT(*) as count
FROM prickles
WHERE source = 'zoom'

UNION ALL

SELECT
  'Unique Meetings with PUPs' as metric,
  COUNT(DISTINCT zoom_meeting_uuid) as count
FROM prickles
WHERE source = 'zoom'
  AND zoom_meeting_uuid IS NOT NULL

UNION ALL

SELECT
  'PUPs with 0 attendance' as metric,
  COUNT(DISTINCT p.id) as count
FROM prickles p
LEFT JOIN attendance a ON p.id = a.prickle_id
WHERE p.source = 'zoom'
  AND a.id IS NULL;
