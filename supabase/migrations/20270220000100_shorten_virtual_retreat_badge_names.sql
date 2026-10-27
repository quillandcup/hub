-- Virtual retreat badge names carried the theme and facilitator ("2024 Spring Virtual Retreat:
-- Your Hero's Journey with ..."), which makes a member's badge list very long. Keep the badge
-- name to "<Year> <Season> Virtual Retreat" and move the full title into the description, which
-- is the tooltip. In one UPDATE the right-hand sides read the old name, so the description keeps
-- the full title.

UPDATE badge_types
SET description = 'Attended the ' || name || '.',
    name = substring(name FROM '^\d{4} \w+ Virtual Retreat')
WHERE key LIKE '%\_virtual\_retreat'
  AND name ~ '^\d{4} \w+ Virtual Retreat: ';
