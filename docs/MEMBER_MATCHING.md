# Member Matching Logic

## Overview

All member name matching for Zoom attendance processing uses the centralized logic in `lib/member-matching.ts`. This ensures consistency across the codebase and makes it easy to test and maintain.

## Matching Rules (Priority Order)

1. **Email Match** (highest priority)
   - Exact match on email address (case-insensitive)
   - Confidence: HIGH
   - Example: `member13@example.com` → Member 13

2. **Alias Match**
   - Exact match on configured alias
   - Confidence: HIGH
   - Example: `member13-display` → Member 13

3. **Normalized Name Match**
   - Fuzzy match after normalization
   - Confidence: HIGH
   - Example: `Member 33` → Member 33
   - Example: `L. M. member13-display` → Member 13 (punctuation removed)

## Name Normalization

Names are normalized by:
- Converting to lowercase
- Removing non-alphanumeric characters (except spaces)
- Collapsing multiple spaces to single space
- Trimming leading/trailing whitespace

Examples:
- `"L. M. member13-display's Name!"` → `"l m besties name"`
- `"  Feya  Rose  "` → `"feya rose"`

## Usage

### Basic Matching

```typescript
import { matchAttendeeToMember } from '@/lib/member-matching'

const match = matchAttendeeToMember(
  'member13-display',                    // Zoom display name
  null,                        // Zoom email (or null)
  members,                     // Array of Member objects
  aliases                      // Array of MemberAlias objects
)

if (match) {
  console.log(`Matched to member ${match.member_id}`)
  console.log(`Method: ${match.method}`) // 'email' | 'alias' | 'normalized_name'
  console.log(`Confidence: ${match.confidence}`) // 'high'
}
```

### Batch Matching

```typescript
import { batchMatchAttendees } from '@/lib/member-matching'

const attendees = [
  { name: 'member13-display', email: null },
  { name: 'Member 33', email: 'member33@example.com' },
]

const { matches, unmatched } = batchMatchAttendees(attendees, members, aliases)

console.log(`Matched: ${matches.length}`)
console.log(`Unmatched: ${unmatched.length}`)
```

## Adding Aliases

When Zoom names don't match member names, add aliases to `supabase/member-aliases.csv`:

```csv
email,alias
member13@example.com,member13-display
member20@example.commember20-display
member20@example.com,Member 20
```

Multiple aliases can map to the same member.

## Testing

Comprehensive test suite at `tests/lib/member-matching.test.ts` covers:
- Name normalization
- All matching rules
- Priority order
- Edge cases (trailing spaces, punctuation, case sensitivity)

Run tests:
```bash
npm test -- tests/lib/member-matching.test.ts
```

## Common Issues

### Issue: Active member showing zero attendance

**Cause**: Zoom name doesn't match member name and no alias exists

**Solution**: 
1. Check Zoom name: `SELECT DISTINCT name FROM zoom_attendees WHERE email = 'member@example.com'`
2. Add alias to `member-aliases.csv`
3. Apply aliases from `/dashboard/import`
4. Reprocess attendance

### Issue: Email match not working

**Cause**: Zoom doesn't capture email for this attendee

**Solution**: Use alias matching instead

### Issue: Multiple people with similar names

**Cause**: Normalized matching can't distinguish them

**Solution**: Use email matching or specific aliases

## Migration Guide

To migrate existing code to use centralized matching:

**Before:**
```typescript
// Scattered matching logic in route
const normalized = name.toLowerCase().replace(/[^a-z0-9\s]/g, '')
const member = members.find(m => m.name.toLowerCase() === normalized)
```

**After:**
```typescript
import { matchAttendeeToMember } from '@/lib/member-matching'

const match = matchAttendeeToMember(name, email, members, aliases)
if (match) {
  const memberId = match.member_id
}
```

## Future Improvements

- [ ] Add fuzzy string matching (Levenshtein distance) for "low" confidence matches
- [ ] Track match statistics to identify problematic names
- [ ] Add ML-based name matching for complex cases
- [ ] Support for name variations (nicknames, shortened forms)
