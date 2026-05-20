# My Attendance Calendar Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three UX issues in the "My Attendance" member calendar: remove the nonsensical legend, show only attended prickles with real attendee counts, and make cards non-clickable.

**Architecture:** Add a `mode` prop to `CalendarWeekView` to gate admin-only UI (legend, click navigation, count label). Extract the prickle-view data shaping into a pure exported function in the page file so it can be unit tested. Update the page to filter to attended-only and fetch real distinct-member counts from `prickle_attendance`.

**Tech Stack:** Next.js 15 App Router, Supabase (PostgreSQL), Vitest, React (client component)

---

## File Map

| File | Change |
|------|--------|
| `components/CalendarWeekView.tsx` | Add `mode` prop; gate legend, onClick, cursor-pointer, count label |
| `app/(member)/calendar/page.tsx` | Export `buildMemberPrickleViews` helper; filter to attended; fetch real counts; pass `mode="member"` |
| `tests/components/CalendarWeekView.test.ts` | Structural tests for `mode` prop, legend, click, count label |
| `tests/calendar/member-prickle-views.test.ts` | Unit tests for `buildMemberPrickleViews` |

---

## Task 1: Add `mode` prop to CalendarWeekView

**Files:**
- Modify: `components/CalendarWeekView.tsx`
- Test: `tests/components/CalendarWeekView.test.ts`

- [ ] **Step 1: Write failing structural tests**

Create `tests/components/CalendarWeekView.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(
  path.join(process.cwd(), 'components/CalendarWeekView.tsx'),
  'utf-8'
);

describe('CalendarWeekView mode prop', () => {
  it('accepts a mode prop in the interface', () => {
    expect(src).toContain('mode?:');
    expect(src).toContain('"admin"');
    expect(src).toContain('"member"');
  });

  it('hides legend in member mode', () => {
    expect(src).toContain('mode !== "member"');
  });

  it('disables click navigation in member mode', () => {
    // onClick must be conditional on mode
    expect(src).toMatch(/mode.*admin.*router\.push|router\.push.*mode.*admin/s);
  });

  it('hides attendee count label in member mode', () => {
    expect(src).toContain('mode !== "member"');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/components/CalendarWeekView.test.ts
```

Expected: 3–4 failures (prop not yet added).

- [ ] **Step 3: Add `mode` prop to the interface**

In `components/CalendarWeekView.tsx`, update the `CalendarWeekViewProps` interface:

```typescript
interface CalendarWeekViewProps {
  prickles: Prickle[];
  weekStartDate: { year: number; month: number; day: number };
  userTimezonePreference?: string;
  mode?: "admin" | "member";
}
```

Update the function signature to destructure `mode`:

```typescript
export default function CalendarWeekView({
  prickles,
  weekStartDate,
  userTimezonePreference = "browser",
  mode = "admin",
}: CalendarWeekViewProps) {
```

- [ ] **Step 4: Gate the legend behind `mode !== "member"`**

Wrap the entire legend `<div className="p-4 border-b ...">` block:

```tsx
{mode !== "member" && (
  <div className="p-4 border-b border-slate-200 dark:border-slate-800">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-6">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Attendance:</span>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-blue-100 dark:bg-blue-950 border border-blue-300 dark:border-blue-700"></div>
            <span className="text-xs text-slate-600 dark:text-slate-400">1-3</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-blue-200 dark:bg-blue-900 border border-blue-400 dark:border-blue-600"></div>
            <span className="text-xs text-slate-600 dark:text-slate-400">4-6</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-blue-400 dark:bg-blue-700 border border-blue-500"></div>
            <span className="text-xs text-slate-600 dark:text-slate-400">7-10</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-blue-600 dark:bg-blue-600 border border-blue-700 dark:border-blue-400"></div>
            <span className="text-xs text-slate-600 dark:text-slate-400">11+</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={showPups}
            onChange={(e) => setShowPups(e.target.checked)}
            className="w-4 h-4 text-blue-600 bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 rounded focus:ring-2 focus:ring-blue-500"
          />
          <span className="text-sm text-slate-700 dark:text-slate-300">Show Pop-Up Prickles</span>
        </label>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Timezone:</span>
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-sm text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 5: Gate the prickle card click behind `mode !== "member"`**

Replace the prickle card `<div>` opening tag (the one with `onClick`) with a conditional:

```tsx
<div
  className={`absolute left-1 right-1 rounded border-2 p-1.5 overflow-hidden pointer-events-auto transition-opacity ${
    mode !== "member" ? "cursor-pointer hover:opacity-90" : ""
  } ${getAttendanceColor(prickle.attendance_count)}`}
  style={{
    top: `${adjustedTop}px`,
    height: `${height}px`,
  }}
  onClick={mode !== "member" ? () => router.push(`/admin/prickles/${prickle.id}`) : undefined}
  onMouseEnter={() => setHoveredPrickle(prickle.id)}
  onMouseLeave={() => setHoveredPrickle(null)}
>
```

- [ ] **Step 6: Gate the attendance count label behind `mode !== "member"`**

Replace the count `<div>` in the card body:

```tsx
{mode !== "member" && (
  <div className="text-xs font-bold mt-0.5">
    {prickle.attendance_count} {prickle.attendance_count === 1 ? "attendee" : "attendees"}
  </div>
)}
```

- [ ] **Step 7: Run tests to confirm they pass**

```bash
npx vitest run tests/components/CalendarWeekView.test.ts
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add components/CalendarWeekView.tsx tests/components/CalendarWeekView.test.ts
git commit -m "feat: add member mode to CalendarWeekView (no legend, no click, no count label)"
```

---

## Task 2: Extract and test the prickle view builder

**Files:**
- Modify: `app/(member)/calendar/page.tsx` (export helper only — no logic changes yet)
- Create: `tests/calendar/member-prickle-views.test.ts`

The page currently shapes prickle data inline. Extract that into an exported pure function so it can be tested before we change the logic.

- [ ] **Step 1: Write failing tests for the new helper**

Create `tests/calendar/member-prickle-views.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildMemberPrickleViews } from '@/app/(member)/calendar/page';

const makePrickle = (id: string, overrides = {}) => ({
  id,
  start_time: '2026-05-12T14:00:00Z',
  end_time: '2026-05-12T15:00:00Z',
  prickle_types: { name: 'Morning Writing' },
  ...overrides,
});

describe('buildMemberPrickleViews', () => {
  it('only includes prickles the member attended', () => {
    const prickles = [makePrickle('a'), makePrickle('b'), makePrickle('c')];
    const attendedIds = new Set(['a', 'c']);
    const countByPrickle = new Map([['a', 3], ['c', 7]]);

    const result = buildMemberPrickleViews(prickles, attendedIds, countByPrickle);

    expect(result.map(p => p.id)).toEqual(['a', 'c']);
  });

  it('sets attendance_count from countByPrickle', () => {
    const prickles = [makePrickle('a')];
    const attendedIds = new Set(['a']);
    const countByPrickle = new Map([['a', 12]]);

    const result = buildMemberPrickleViews(prickles, attendedIds, countByPrickle);

    expect(result[0].attendance_count).toBe(12);
  });

  it('falls back to 1 if prickle not in countByPrickle', () => {
    const prickles = [makePrickle('a')];
    const attendedIds = new Set(['a']);
    const countByPrickle = new Map<string, number>();

    const result = buildMemberPrickleViews(prickles, attendedIds, countByPrickle);

    expect(result[0].attendance_count).toBe(1);
  });

  it('uses prickle_types.name as prickle_type', () => {
    const prickles = [makePrickle('a', { prickle_types: { name: 'Deep Work' } })];
    const attendedIds = new Set(['a']);
    const countByPrickle = new Map([['a', 2]]);

    const result = buildMemberPrickleViews(prickles, attendedIds, countByPrickle);

    expect(result[0].prickle_type).toBe('Deep Work');
  });

  it('falls back to "Unknown" when prickle_types is null', () => {
    const prickles = [makePrickle('a', { prickle_types: null })];
    const attendedIds = new Set(['a']);
    const countByPrickle = new Map([['a', 1]]);

    const result = buildMemberPrickleViews(prickles, attendedIds, countByPrickle);

    expect(result[0].prickle_type).toBe('Unknown');
  });

  it('sets host fields to empty/false for member view', () => {
    const prickles = [makePrickle('a')];
    const attendedIds = new Set(['a']);
    const countByPrickle = new Map([['a', 2]]);

    const result = buildMemberPrickleViews(prickles, attendedIds, countByPrickle);

    expect(result[0].host).toBe('');
    expect(result[0].host_id).toBeUndefined();
    expect(result[0].host_missing).toBe(false);
    expect(result[0].host_late).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/calendar/member-prickle-views.test.ts
```

Expected: all fail — `buildMemberPrickleViews` is not exported yet.

- [ ] **Step 3: Export the helper from the page file**

In `app/(member)/calendar/page.tsx`, extract the existing inline prickle mapping into an exported function. Add it above the `export default` function:

```typescript
export function buildMemberPrickleViews(
  prickles: any[],
  attendedIds: Set<string>,
  countByPrickle: Map<string, number>
) {
  return prickles
    .filter((p: any) => attendedIds.has(p.id))
    .map((p: any) => ({
      id: p.id,
      start_time: p.start_time,
      end_time: p.end_time,
      prickle_type: p.prickle_types?.name ?? "Unknown",
      attendance_count: countByPrickle.get(p.id) ?? 1,
      host: "",
      host_id: undefined,
      host_missing: false,
      host_late: false,
    }));
}
```

In the page body, replace the existing `pricklesForView` assignment:

```typescript
// Remove this block:
// const pricklesForView = (prickles ?? []).map((p: any) => ({
//   id: p.id,
//   ...
// }));

// Replace with (countByPrickle will be added in Task 3 — for now pass an empty Map):
const pricklesForView = buildMemberPrickleViews(
  prickles ?? [],
  attendedIds,
  new Map()
);
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run tests/calendar/member-prickle-views.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add app/\(member\)/calendar/page.tsx tests/calendar/member-prickle-views.test.ts
git commit -m "refactor: extract buildMemberPrickleViews helper, filter to attended prickles"
```

---

## Task 3: Fetch real attendee counts and wire up mode prop

**Files:**
- Modify: `app/(member)/calendar/page.tsx`

- [ ] **Step 1: Add the attendee count query**

In `app/(member)/calendar/page.tsx`, after the `attendedIds` Set is built, add:

```typescript
// Fetch distinct member count per attended prickle
// prickle_attendance allows multiple rows per (member_id, prickle_id) for leave/rejoin,
// so we count distinct member_ids in memory.
const attendedPrickleIds = [...attendedIds];
let countByPrickle = new Map<string, number>();

if (attendedPrickleIds.length > 0) {
  const { data: countRows } = await supabase
    .from("prickle_attendance")
    .select("prickle_id, member_id")
    .in("prickle_id", attendedPrickleIds);

  const memberSets = new Map<string, Set<string>>();
  countRows?.forEach(({ prickle_id, member_id }) => {
    if (!memberSets.has(prickle_id)) memberSets.set(prickle_id, new Set());
    memberSets.get(prickle_id)!.add(member_id);
  });
  countByPrickle = new Map(
    [...memberSets.entries()].map(([id, members]) => [id, members.size])
  );
}
```

- [ ] **Step 2: Pass `countByPrickle` to the helper**

Replace the `new Map()` placeholder from Task 2 with the real map:

```typescript
const pricklesForView = buildMemberPrickleViews(
  prickles ?? [],
  attendedIds,
  countByPrickle
);
```

- [ ] **Step 3: Pass `mode="member"` to CalendarWeekView**

In the JSX return, add the prop:

```tsx
<CalendarWeekView
  prickles={pricklesForView}
  weekStartDate={{
    year: weekStart.getFullYear(),
    month: weekStart.getMonth(),
    day: weekStart.getDate(),
  }}
  userTimezonePreference={userTimezone}
  mode="member"
/>
```

- [ ] **Step 4: Run all tests**

```bash
npx vitest run
```

Expected: all pass (no regressions).

- [ ] **Step 5: Commit**

```bash
git add app/\(member\)/calendar/page.tsx
git commit -m "feat: fetch real attendee counts for My Attendance calendar"
```

---

## Task 4: Manual smoke test

- [ ] **Start the dev server**

```bash
npm run dev
```

- [ ] **Verify member calendar**

Navigate to `/calendar`. Confirm:
1. No legend bar at the top.
2. Only prickles you attended are shown (weeks with no attendance show an empty grid).
3. Prickle cards have a color depth proportional to real group size (a prickle with 8 attendees is darker than one with 2).
4. Cards are not clickable — no pointer cursor, no navigation on click.
5. Cards do NOT show "N attendees" text.

- [ ] **Verify admin calendar is unchanged**

Navigate to `/admin/calendar`. Confirm:
1. Legend is still visible.
2. Cards are clickable and navigate to `/admin/prickles/[id]`.
3. Cards still show "N attendees" text.

- [ ] **Final commit if any fixups were needed**

```bash
git add -p
git commit -m "fix: [describe any fixups from smoke test]"
```
