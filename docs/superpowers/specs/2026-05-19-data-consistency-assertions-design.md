# Data Consistency Assertions — Design Spec

**Date:** 2026-05-19
**Status:** Approved

## Goal

Find and fix every place in the UI where a numeric claim can produce an impossible or
inconsistent value. Leave behind vitest assertions that catch regressions automatically,
so we stop discovering bugs by eye in the UI.

## What "numeric claim" means

Any value the UI renders that is derived from a query: match rates (X/Y fractions),
attendee counts, streak values, engagement percentages, at-risk counts, orphaned event
counts, durations shown in attendance tables. Includes cases where two surfaces show
the same derived number but compute it differently.

## Scope

### In scope

- Fix the known "1437/1426 matched is impossible" bug in the hygiene dashboard
- Audit all numeric claims across all admin and member UI pages
- Extract inline query logic from server components into testable query functions
- Write vitest assertions covering the eight invariant categories below
- Fix every bug that causes an assertion to fail

### Out of scope (separate TODO)

`tests/api/calendar-zoom-integration/` — a dedicated suite testing the combined
Google Calendar + Zoom pipeline end-to-end: correct PUP vs calendar prickle
attribution, no double-counting, correct attendee deduplication across join/rejoin
sessions. Tracked as a TODO; not part of this work.

## Surfaces to audit

| Surface | Numeric claims |
|---|---|
| `/admin/hygiene` | Calendar match rate (X/Y), host assignment rate, Zoom attendee match rate, orphaned event count |
| `/admin` (dashboard) | Total members, engagement %, median hours, at-risk count, top attendees count |
| `/admin/prickles/[id]` | Attendee count, duration per attendee, host present/absent |
| `/prickles/[id]` (member) | Attendee count, duration per attendee |
| `/admin/members/[id]` | Attendance count, streak values |
| `/members/[id]` (member profile) | Attendance count, streak values |
| Calendar week view tooltip | Attendee count per prickle slot |

## Invariant categories

Eight invariants, derived from recurring data bug patterns in git history:

| # | Name | Assertion |
|---|---|---|
| 1 | Temporal sanity | `leave_time > join_time` for every `prickle_attendance` row; `end_time > start_time` for every `prickles` row |
| 2 | No overlap | No two prickles of the same source overlap in time; no member has overlapping attendance records for different prickles simultaneously |
| 3 | No double-attribution | An attendee matched to a calendar prickle does not also appear in a PUP for the same time window. Note: this asserts the invariant holds on existing data; correctness of the processing logic that produces this outcome is covered by the calendar-zoom integration TODO. |
| 4 | Scope correctness | Records in time-windowed metrics (30d, 7d) have no future-dated `join_time` or `start_time` |
| 5 | Match ≤ total | In any X/Y display, X ≤ Y; `orphaned = total - matched - unmatched ≥ 0` |
| 6 | Cross-surface agreement | Attendee count for a given prickle agrees between admin and member page query paths |
| 7 | Streak consistency | `currentStreak ≤ longestStreak`; `currentStreak = 0` when last attendance is >2 weeks ago |
| 8 | At-risk bounds | `atRiskCount ≤ activeMemberCount` |

## Architecture: extract → test → fix

### Why extraction is required

Query logic currently lives inline in `page.tsx` server components. Tests cannot import
and call page components directly. The fix: move query logic into pure functions in
`lib/queries/`, which both the page and the tests import. When a bug is fixed in the
query function, the page display and the test both benefit automatically. No query logic
is duplicated.

### Query modules to create

```
lib/
  queries/
    hygiene.ts      # getCalendarMatchMetrics(), getZoomMatchMetrics()
    prickle.ts      # getPrickleAttendees(prickleId)
    dashboard.ts    # getDashboardMetrics()
    member.ts       # getMemberAttendanceStats(memberId)
    calendar.ts     # getPricklesInRange(from, to)
```

Each function is async, accepts a Supabase client, and returns a typed object. The
calling page passes its server-side Supabase client in; the test passes a test client.

### Test structure

```
tests/
  consistency/
    numeric-invariants.test.ts    # invariants 5, 8 (match ≤ total, at-risk bounds)
    temporal-sanity.test.ts       # invariant 1 (duration > 0)
    no-overlap.test.ts            # invariants 2, 3 (prickle overlap, double-attribution)
    scope-correctness.test.ts     # invariant 4 (no future records in historical metrics)
    cross-surface.test.ts         # invariant 6 (same prickle count on admin + member page)
    streak-consistency.test.ts    # invariant 7 (streak bounds)
```

Tests seed minimal data into the test DB, call the extracted query functions, and assert
the invariant. They do not re-implement the query logic — they call the same function
the page uses.

### Fix for "1437/1426 matched is impossible"

`getCalendarMatchMetrics()` will redefine `matched` as "Bronze `calendar_events` rows
that have a corresponding Silver `prickles` row" (a join), rather than the current
approach of counting Silver prickles independently. This aligns both sides of the
fraction to the same universe. The exact join key (`google_event_id` or equivalent)
is confirmed during implementation by reading the `prickles` schema.

## Build sequence

1. Read `prickles` schema to confirm the join key between Bronze `calendar_events` and Silver `prickles`
2. Create `lib/queries/` modules; refactor pages to call them (no behavior change yet)
3. Write `tests/consistency/` assertions against the extracted functions
4. Run assertions — identify all failures
5. Fix each failing assertion in the query function
6. Verify all assertions pass; verify pages still render correctly

## What we are NOT doing

- Rewriting the hygiene dashboard as automated tests — it stays as a manual diagnostic tool
- Full extraction of all query logic from all pages — only pages with invariants to assert
- Building a repair/reprocessing pipeline — this is code fixes only
