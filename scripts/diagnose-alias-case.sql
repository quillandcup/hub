-- Check actual alias values to understand case sensitivity issues

-- 1. Show the actual aliases for problem hosts
SELECT
  a.alias,
  LENGTH(a.alias) as alias_length,
  m.name as member_name,
  m.email
FROM member_name_aliases a
INNER JOIN members m ON a.member_id = m.id
WHERE a.alias IN ('member13-display', 'bestie', 'Lili', 'lili', 'Allison', 'allison',
                   'Courtney', 'courtney', 'Kase', 'kase')
ORDER BY a.alias;

-- 2. Check for whitespace in aliases (length difference indicates trailing spaces)
SELECT
  '"' || a.alias || '"' as alias_with_quotes,
  LENGTH(a.alias) as length,
  LENGTH(TRIM(a.alias)) as trimmed_length,
  CASE
    WHEN LENGTH(a.alias) != LENGTH(TRIM(a.alias)) THEN 'HAS WHITESPACE'
    ELSE 'clean'
  END as whitespace_check,
  m.name as member_name
FROM member_name_aliases a
INNER JOIN members m ON a.member_id = m.id
WHERE a.alias ILIKE '%bestie%'
   OR a.alias ILIKE '%lili%'
   OR a.alias ILIKE '%courtney%'
ORDER BY a.alias;

-- 3. Count aliases by case pattern
SELECT
  a.alias,
  COUNT(*) as count,
  STRING_AGG(DISTINCT m.name, ', ') as members
FROM member_name_aliases a
INNER JOIN members m ON a.member_id = m.id
GROUP BY a.alias
HAVING COUNT(*) > 1  -- Show duplicates
ORDER BY count DESC;
