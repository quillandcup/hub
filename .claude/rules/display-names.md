---
paths:
  - "src/app/**/*.tsx"
  - "src/components/**"
  - "src/lib/member-display-name.ts"
  - "tests/lib/member-display-names.test.ts"
---

### Display Names

**RULE**: A member is shown by `getMemberDisplayName` (`src/lib/member-display-name.ts`: the chosen display name, else the legal name), never `member.name`: in member pages and in admin alike, since that is what they are known by in the community. Select `display_name` beside `name` (the `member_directory` view and the members repository rows have it) and carry it through.

- **In admin, show the legal name beside it where identity matters** (member rows in tables, the member page header): the display name leads, the legal name sits beneath in small muted text when it differs. Pickers (`MemberSearch`, `memberSearchItem`) search both. Sort by the name shown.
- **Keep the legal name where it is the point**: billing, Kajabi and Stripe reconciliation, merge/split and duplicate detection, name-matching and alias tools, the Real Name field, exports, and anything sent to an external system.
- `tests/lib/member-display-names.test.ts` fails on a new `host.name`; list a file there, with a reason, only when it just maps rows or needs the legal name.
