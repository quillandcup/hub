# Member Self View — Design Spec

**Date:** 2026-05-15
**Scope:** Tier 3 MVP + Tier 2 self-view from the four-tier member profile vision

---

## Background

The existing spec (`2026-05-15-my-attendance-and-member-pages-design.md`) defines a four-tier member profile system. This spec details the implementation of Tiers 2 and 3:

- **Tier 3 MVP** — `/members/[id]` route visible to all authenticated members
- **Tier 2 self-view** — additional sections visible only when the viewer is the profile owner

Kajabi-sourced fields (bio, location, social links, `share_with_members`) are deferred until the Kajabi bronze import is built.

---

## Route

`app/(member)/members/[id]/page.tsx`

Within the `(member)` layout group, so it inherits the sidebar nav, user menu, and sudo banner.

---

## Access Control

- Any authenticated member can access `/members/[id]`.
- Self-view is detected server-side: `effectiveIdentity.memberId === params.id`.
- The `share_with_members` privacy flag is not yet in the DB. Until it is, all members are visible to all other authenticated members.
- If `id` does not exist in `members`, return 404 (`notFound()`).

---

## Data Queries

All queries run server-side in the page component.

**Always fetched:**
```sql
-- Member basic info
SELECT id, name, joined_at, status, total_sessions
FROM members JOIN member_metrics ON member_id = members.id
WHERE members.id = :id
```

**Self-view only:**
```sql
-- Email and full metrics
SELECT email, sessions_last_7_days, sessions_last_30_days, total_sessions, last_attended_at
FROM members JOIN member_metrics USING (member_id)
WHERE members.id = :id

-- Prickle history (last 50, most recent first)
SELECT pa.join_time, pa.leave_time, pt.name AS prickle_type
FROM prickle_attendance pa
JOIN prickles p ON pa.prickle_id = p.id
JOIN prickle_types pt ON p.type_id = pt.id
WHERE pa.member_id = :id
ORDER BY pa.join_time DESC
LIMIT 50
```

Streak computation runs in memory from the attendance records (no extra DB query).

---

## Streak Computation

From `prickle_attendance` rows, group by ISO week number. A "streak" is a run of consecutive weeks each having ≥1 attendance.

- **Current streak** — count backward from the most recent week with attendance. Stop at the first gap.
- **Longest streak** — max run length across all history.

Computed server-side as a pure function over the attendance rows.

---

## Page Layout

### Header
- Member name (always)
- "Member since [Month Year]" (always)

### Tier 3 section (all members)
- **Total prickles attended** — from `member_metrics.total_sessions`
- *(Bio, location, social links deferred — no placeholder rendered)*

### Tier 2 section (self only)
- **Email** — from `members.email`
- **Status badge** — active / on_hiatus / inactive
- **Engagement metrics row** — last 7 days / last 30 days / total sessions
- **Streaks** — current streak (in weeks), longest streak (in weeks)
- **Prickle history** — table showing date, prickle type, duration in minutes (leave_time − join_time). Last 50 records. Grouped or sorted by descending date.

---

## Navigation

Add a "My Profile" entry to `MemberNavigation` between the current "My Calendar" link and the admin portal footer:

```
📅  My Calendar      /calendar
👤  My Profile       /members/:myId
```

The nav link target is `effectiveIdentity.memberId` resolved at layout time. Pass it as a prop to `MemberNavigation` (currently `MemberNavigation` only receives `isAdmin`).

Active state: `pathname.startsWith('/members/')`.

---

## Files to Create / Modify

| File | Change |
|------|--------|
| `app/(member)/members/[id]/page.tsx` | New — full page component |
| `components/MemberNavigation.tsx` | Add `memberId` prop; add "My Profile" nav link |
| `app/(member)/layout.tsx` | Pass `effectiveIdentity.memberId` to `MemberNavigation` |

No new API routes, client components, or database migrations needed.

---

## Out of Scope

- Member directory / list page (not part of this spec)
- Prickle card clickability in `CalendarWeekView` (separate TODO)
- Prickle detail page (separate TODO)
- Kajabi fields (bio, location, social links, share_with_members)
- Tier 4 public author profile
