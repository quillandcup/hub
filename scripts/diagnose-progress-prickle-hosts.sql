-- Diagnose Progress Prickle host assignment issues
--
-- Run this against production database to investigate why most Progress Prickles
-- don't have hosts assigned

-- 1. Count Progress Prickles with vs without hosts
SELECT
  CASE WHEN host IS NOT NULL THEN 'With Host' ELSE 'Without Host' END as status,
  COUNT(*) as count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) as percentage
FROM prickles
WHERE type_id = (SELECT id FROM prickle_types WHERE normalized_name = 'progress')
  AND source = 'calendar'
GROUP BY (host IS NOT NULL)
ORDER BY status;

-- 2. Sample calendar events that should create Progress Prickles
-- Look for events with "Prickle w/" or just "Prickle" pattern
SELECT
  ce.summary,
  ce.organizer_name,
  ce.creator_name,
  ce.organizer_email,
  ce.creator_email,
  CASE
    WHEN ce.summary ~* '\s*prickle\s*w/\s*(\S+)' THEN SUBSTRING(ce.summary FROM '\s*prickle\s*w/\s*(\S+)')
    ELSE NULL
  END as extracted_host_name
FROM calendar_events ce
WHERE ce.summary ~* '^\s*prickle\s*w/' OR ce.summary ~* '^\s*prickle\s*$'
ORDER BY ce.start_time DESC
LIMIT 20;

-- 3. Check calendar event summary patterns for potential Progress Prickles
SELECT
  CASE
    WHEN ce.summary ~* 'w/' THEN 'Has w/ pattern'
    WHEN ce.summary ~* '^\s*prickle\s*$' THEN 'Just "Prickle" (no host)'
    ELSE 'Other'
  END as pattern_type,
  COUNT(*) as count
FROM calendar_events ce
WHERE ce.summary ILIKE '%prickle%'
GROUP BY pattern_type
ORDER BY count DESC;

-- 4. Sample organizer/creator names from calendar events that match Progress Prickle pattern
-- This helps identify if the names are in the system as members
SELECT DISTINCT
  COALESCE(ce.organizer_name, ce.creator_name, 'Unknown') as potential_host,
  ce.organizer_email,
  ce.creator_email,
  EXISTS(
    SELECT 1 FROM members m
    WHERE m.email IN (ce.organizer_email, ce.creator_email)
  ) as has_member_match_by_email
FROM calendar_events ce
WHERE ce.summary ~* '^\s*prickle\s*w/' OR ce.summary ~* '^\s*prickle\s*$'
LIMIT 20;

-- 5. Check if members exist for common host names in Progress Prickle events
-- Extract the host name from "Prickle w/[Name]" and see if we have a member match
WITH extracted_hosts AS (
  SELECT DISTINCT
    TRIM(SUBSTRING(ce.summary FROM 'w/\s*([^''"\s]+)')) as extracted_name
  FROM calendar_events ce
  WHERE ce.summary ~* 'prickle\s*w/'
    AND SUBSTRING(ce.summary FROM 'w/\s*([^''"\s]+)') IS NOT NULL
)
SELECT
  eh.extracted_name,
  COUNT(*) OVER (PARTITION BY eh.extracted_name) as event_count,
  m.id IS NOT NULL as has_member,
  m.name as member_name,
  m.email as member_email
FROM extracted_hosts eh
LEFT JOIN members m ON LOWER(TRIM(m.name)) = LOWER(eh.extracted_name)
  OR LOWER(TRIM(m.name)) LIKE '%' || LOWER(eh.extracted_name) || '%'
ORDER BY event_count DESC
LIMIT 20;
