# My Attendance Calendar Fixes + Member Pages Vision

**Date:** 2026-05-15

## Summary

Two scopes in one spec:

1. Fix three UX bugs in the "My Attendance" calendar view.
2. Document the four-tier member profile page vision and leave TODOs for deferred work.

---

## Part 1: My Attendance Calendar Fixes

### Problems

- **Legend is wrong context.** The `CalendarWeekView` legend shows attendance intensity (1–3 / 4–6 / 7–10 / 11+) for group viewing. On "My Attendance," `attendance_count` is always 0 or 1, making the legend meaningless.
- **Prickle cards link to `/admin/prickles/[id]`**, which is not accessible to non-admin members.
- **Cards say "0 attendees" / "1 attendee"** because the page encodes personal attendance as 0 or 1 instead of real counts. "My Attendance" should be a personal log (only attended prickles, with real group counts shown).

### Solution

**Add `mode?: "admin" | "member"` prop to `CalendarWeekView`.**

Member mode changes:
- Hides the legend entirely.
- Removes `onClick` and `cursor-pointer` from prickle cards (non-clickable for now).
- Hides the `attendance_count` display line from card body — the card already shows type and time, which is sufficient for a personal log.

**Filter "My Attendance" to attended prickles only.**

The page already builds `attendedIds`. Change `pricklesForView` to only include prickles where `attendedIds.has(p.id)`. Prickles the member didn't attend are not shown at all.

**Fetch real attendee counts.**

Add a query to count `prickle_attendance` rows per `prickle_id` for the week. Map actual counts into `attendance_count` so the color intensity on attended cards reflects real group size. (The count display line is hidden in member mode, but the color encoding remains meaningful — darker = more people.)

### Files changed

- `components/CalendarWeekView.tsx` — add `mode` prop, conditional legend, conditional click, conditional count label
- `app/(member)/calendar/page.tsx` — filter to attended, fetch real counts, pass `mode="member"`

---

## Part 2: Member Pages — Four-Tier Vision

### Tiers

| Tier | Audience | Route | Content |
|------|----------|-------|---------|
| 1 — Admin | Admins only | `/admin/members/[id]` (exists) | Full data: engagement score, slack activity, Zoom replays, risk level, all metrics |
| 2 — Self | Member viewing their own profile | `/members/[id]` | Streaks, personal prickle history, gamified engagement stats |
| 3 — Members | All authenticated members | `/members/[id]` | Name, photo, location, social links (Instagram, Facebook, Twitter), bio |
| 4 — Public | Anyone (unauthenticated) | TBD | Author profile: published books, WIP (author-configurable), Amazon/Goodreads links |

Tiers 2 and 3 share the same route. The page renders additional self-only sections (streaks, prickle log) when the viewer is the profile owner.

### Data model

All profile fields (bio, location, instagram_url, facebook_url, twitter_url, share_with_members) come from Kajabi. Kajabi is the source of truth. These fields need to be:

1. Added to the Kajabi bronze import (bronze layer).
2. Mapped into the `members` silver table alongside existing fields.

No separate `member_profiles` table is needed. The `share_with_members` flag gates Tier 3 visibility — if false, other members see only name and nothing else.

### Navigation

`/members/[id]` gets a left-nav entry ("Community" or "Members") in `MemberNavigation`. This nav link is **not added until the route is built**.

### Privacy rules

- `share_with_members = false` → Tier 3 visitors see name only.
- Self-view always shows full Tier 2 content regardless of the flag.
- Tier 4 (public) only exposes what the member explicitly marks as public.

---

## TODOs (deferred)

- [ ] **Kajabi bronze import:** Add bio, location, instagram_url, facebook_url, twitter_url, share_with_members to bronze import and `members` silver table.
- [x] **`/members/[id]` Tier 3 MVP:** Build the route, page, and left-nav link. Triggered when prickle cards become clickable and prickle detail pages show member links. ✅ 2026-05-16
- [x] **Tier 2 self-view:** Add streaks and personal prickle history to `/members/[id]` when viewer is the owner. ✅ 2026-05-16
- [ ] **Prickle card click:** Make cards clickable in `CalendarWeekView` member mode; link to a member-facing prickle detail page.
- [ ] **Prickle detail page (member-facing):** Lightweight page showing type, date, time, duration, attendee count. No sensitive member data.
- [ ] **Tier 4 public author profile:** Separate route (TBD), configurable fields, links to Amazon/Goodreads.
