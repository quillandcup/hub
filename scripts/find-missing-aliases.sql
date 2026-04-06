-- Find potential name aliases for members with zero attendance
-- This helps identify Zoom names that might match member records

-- Active members with zero attendance
WITH zero_attendance_members AS (
  SELECT
    m.id,
    m.name,
    m.email,
    LOWER(REGEXP_REPLACE(m.name, '[^a-zA-Z0-9\s]', '', 'g')) as normalized_name
  FROM members m
  LEFT JOIN attendance a ON m.id = a.member_id
  WHERE m.status = 'active'
  GROUP BY m.id, m.name, m.email
  HAVING COUNT(a.id) = 0
),

-- Distinct Zoom names with null emails (potential aliases needed)
unmatched_zoom_names AS (
  SELECT DISTINCT
    z.name,
    LOWER(REGEXP_REPLACE(z.name, '[^a-zA-Z0-9\s]', '', 'g')) as normalized_zoom_name,
    COUNT(*) as attendance_count
  FROM zoom_attendees z
  WHERE z.email IS NULL
    -- Not already aliased
    AND NOT EXISTS (
      SELECT 1 FROM member_name_aliases a WHERE a.alias = z.name
    )
  GROUP BY z.name
  HAVING COUNT(*) > 2  -- Only show names with multiple appearances
)

-- Find potential matches using fuzzy name matching
SELECT
  zam.name as member_name,
  zam.email as member_email,
  uzn.name as zoom_name,
  uzn.attendance_count as zoom_appearances,
  -- Check if zoom name contains member's first name
  CASE
    WHEN uzn.normalized_zoom_name LIKE '%' || SPLIT_PART(zam.normalized_name, ' ', 1) || '%' THEN 'LIKELY'
    WHEN uzn.normalized_zoom_name LIKE '%' || SPLIT_PART(zam.normalized_name, ' ', 2) || '%' THEN 'POSSIBLE'
    ELSE 'MANUAL_CHECK'
  END as match_confidence
FROM zero_attendance_members zam
CROSS JOIN unmatched_zoom_names uzn
WHERE
  -- First name match
  uzn.normalized_zoom_name LIKE '%' || SPLIT_PART(zam.normalized_name, ' ', 1) || '%'
  -- OR last name match
  OR uzn.normalized_zoom_name LIKE '%' || SPLIT_PART(zam.normalized_name, ' ', 2) || '%'
  -- OR last name match (for 3-word names)
  OR (
    ARRAY_LENGTH(STRING_TO_ARRAY(zam.normalized_name, ' '), 1) >= 3
    AND uzn.normalized_zoom_name LIKE '%' || SPLIT_PART(zam.normalized_name, ' ', 3) || '%'
  )
ORDER BY
  match_confidence,
  uzn.attendance_count DESC,
  zam.name;
