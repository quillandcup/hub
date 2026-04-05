# Member Aliases

This file documents how to manage member name aliases for Zoom attendance matching.

## What are aliases?

Aliases map Zoom display names (which vary wildly) to canonical member records. For example:
- "lili" → Lili Raphaelson
- "Sam" → Sam Anne Cook
- "Member 10", "Member 10" → member10@example.com

## How to add aliases

1. Edit `supabase/member-aliases.csv`
2. Add rows with format: `email,alias`
3. Make sure members exist (import from Kajabi first!)
4. Go to `/dashboard/import` page
5. Click "Apply Aliases" button

## File format

```csv
email,alias
member9@example.commember9-display
member10@example.com,Member 10
member10@example.com,Member 10
member12@example.commember12-display
```

- **email**: The member's email address (must exist in members table)
- **alias**: The Zoom display name to map to this member

Multiple aliases can point to the same email.

## When to use this

1. After importing members from Kajabi
2. Before processing Zoom attendance
3. Whenever you notice unmatched Zoom attendees in the name matching report

## Production vs Development

This works the same in both environments:
1. Import members (Kajabi CSV)
2. Apply aliases (from CSV)
3. Process Zoom attendance (uses aliases for matching)

The CSV file is version-controlled and shared across all environments.
