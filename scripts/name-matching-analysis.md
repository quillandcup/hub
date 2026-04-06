# Name Matching Analysis

## Problem Summary

26 out of 63 active members showing zero attendance due to name matching issues. Zoom attendees often appear without email addresses and use shortened names or nicknames that don't match the full names in the members table.

## Root Cause

The attendance matching logic tries three methods in order:
1. **Email match** - fails when Zoom has null email
2. **Alias match** - fails when no alias exists  
3. **Normalized name match** - fails when names don't match exactly

Example: "member13-display" (Zoom) doesn't match "Member 13" (member record)

## Aliases Added

| Zoom Name | Member Name | Member Email |
|-----------|-------------|--------------|
| member13-display | Member 13 | member13@example.com |
| Allison  | Member 14 | member14@example.com |
| Iris | Member 15 | member15@example.com |
| Member 16 | Member 16 | member16@example.com |
| Member 17 | Member 17 | member17@example.com |
| Member 18 | Member 18 | member18@example.com |

## Top Unmatched Zoom Names (Requiring Manual Review)

These names appear frequently in Zoom but don't match any member:

| Zoom Name | Appearances | Meetings |
|-----------|------------|----------|
| Member 33 | 78 | 66 |
| Member 43 | 55 | 54 |
| Member 5 | 40 | 35 |
| Member 23 | 32 | 28 |
| Member 7 | 32 | 28 |
| Member 44 | 28 | 26 |
| Member 45 | 28 | 28 |
| Member 46 | 27 | 22 |
| Member 47 | 26 | 23 |
| Member 24 | 25 | 25 |
| Member 48 | 25 | 25 |
| Member 49 | 25 | 23 |
| member19-display | 18 | 13 |
| Member 21 | 18 | 14 |
| Member 50 | 16 | 16 |
| Member 51 | 15 | 15 |
| Member 20 | 15 | 13 |
| Member 52 | 15 | 14 |

## Active Members Still at Zero Attendance

After adding the aliases above, these members will still show zero unless we find their Zoom names:

- Member 18 ❓ (might be fixed by "Member 18" alias)
- Member 14 ❓ (might be fixed by "Allison " alias)
- Member 16 ❓ (might be fixed by "Member 16" alias)
- Member 53
- Member 17 ❓ (might be fixed by "Member 17" alias)
- Member 54
- Member 55
- Member 56
- Member 57
- Member 15 ❓ (might be fixed by "Iris" alias)
- Member 58
- Member 59
- Member 60
- Member 61
- Member 62
- Member 63
- Member 13 ✅ (fixed with "member13-display" alias)
- Member 64
- Member 65
- Member 66
- Member 67 (might match "Member 7"?)
- Member 68
- Member 69
- Member 70
- Member 71
- Member 72

## Next Steps

1. **Reprocess attendance** from the dashboard to apply the new aliases
2. **Manual review needed**: You'll need to identify which Zoom names correspond to which members
3. **Add more aliases**: Use this SQL pattern:
   ```sql
   INSERT INTO member_name_aliases (member_id, alias) VALUES
     ((SELECT id FROM members WHERE email = 'member@example.com'), 'Their Zoom Name')
   ON CONFLICT DO NOTHING;
   ```

## Finding Zoom Names for a Specific Member

To help identify a member's Zoom name, search for partial matches:

```sql
-- Example: Find Zoom names that might be Member 53
SELECT DISTINCT z.name, COUNT(*) as appearances
FROM zoom_attendees z
WHERE z.email IS NULL
  AND (z.name ILIKE '%briana%' OR z.name ILIKE '%meyer%')
GROUP BY z.name
ORDER BY COUNT(*) DESC;
```

## Diagnostic Queries

See `scripts/find-missing-aliases.sql` for automated fuzzy matching (but expect false positives).

View the current alias mappings:
```sql
SELECT m.name as member_name, m.email, a.alias as zoom_name
FROM member_name_aliases a
JOIN members m ON m.id = a.member_id
ORDER BY m.name;
```
