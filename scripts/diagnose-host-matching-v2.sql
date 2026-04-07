-- Diagnose why host match rate is still only 17% after the fix
-- Run this against production to understand the issue

-- 1. Count prickles by source and host assignment
SELECT
  source,
  CASE WHEN host IS NOT NULL THEN 'With Host' ELSE 'Without Host' END as status,
  COUNT(*) as count
FROM prickles
GROUP BY source, (host IS NOT NULL)
ORDER BY source, status;

-- 2. Sample calendar events to see their summary patterns
SELECT
  ce.summary,
  CASE
    WHEN ce.summary ~* 'w/' THEN 'Has w/ pattern'
    WHEN ce.summary ~* '^\s*prickle\s*$' THEN 'Just "Prickle"'
    ELSE 'Other pattern'
  END as pattern_type,
  ce.organizer_name,
  ce.creator_name,
  p.host IS NOT NULL as prickle_has_host
FROM calendar_events ce
LEFT JOIN prickles p ON p.source = 'calendar'
  AND p.start_time = ce.start_time
  AND p.end_time = ce.end_time
WHERE ce.summary IS NOT NULL
ORDER BY pattern_type, RANDOM()
LIMIT 30;

-- 3. Count calendar events by summary pattern
SELECT
  CASE
    WHEN ce.summary ~* 'w/' THEN 'Has w/ pattern'
    WHEN ce.summary ~* '^\s*prickle\s*$' THEN 'Just "Prickle"'
    ELSE 'Other pattern (no host expected)'
  END as pattern_type,
  COUNT(*) as event_count,
  SUM(CASE WHEN p.host IS NOT NULL THEN 1 ELSE 0 END) as prickles_with_host,
  ROUND(100.0 * SUM(CASE WHEN p.host IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 1) as match_rate
FROM calendar_events ce
LEFT JOIN prickles p ON p.source = 'calendar'
  AND p.start_time = ce.start_time
  AND p.end_time = ce.end_time
WHERE ce.summary IS NOT NULL
GROUP BY pattern_type
ORDER BY event_count DESC;

-- 4. For events WITH "w/" pattern, check if extracted names match members
WITH extracted_hosts AS (
  SELECT
    ce.summary,
    TRIM(SUBSTRING(ce.summary FROM 'w/\s*([^\s,]+)')) as extracted_name,
    p.host as prickle_host_id
  FROM calendar_events ce
  LEFT JOIN prickles p ON p.source = 'calendar'
    AND p.start_time = ce.start_time
    AND p.end_time = ce.end_time
  WHERE ce.summary ~* 'w/'
)
SELECT
  eh.extracted_name,
  COUNT(*) as event_count,
  SUM(CASE WHEN eh.prickle_host_id IS NOT NULL THEN 1 ELSE 0 END) as matched,
  SUM(CASE WHEN eh.prickle_host_id IS NULL THEN 1 ELSE 0 END) as unmatched,
  -- Check if member exists by name/alias
  EXISTS(
    SELECT 1 FROM members m
    WHERE LOWER(TRIM(m.name)) LIKE '%' || LOWER(eh.extracted_name) || '%'
  ) as has_similar_member_name,
  EXISTS(
    SELECT 1 FROM member_name_aliases a
    WHERE LOWER(TRIM(a.alias)) = LOWER(eh.extracted_name)
  ) as has_exact_alias
FROM extracted_hosts eh
WHERE eh.extracted_name IS NOT NULL
GROUP BY eh.extracted_name
ORDER BY event_count DESC
LIMIT 20;
