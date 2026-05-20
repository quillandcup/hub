# Clickable Calendar Prickles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make prickle blocks in the member attendance calendar clickable, linking to a shared `/prickles/{id}` detail page that shows full prickle info with role-appropriate member links.

**Architecture:** Move the existing `/admin/prickles/{id}` page to `/prickles/{id}` under the `(member)` route group. The page queries the user's role to set `memberBasePath` (`/members` vs `/admin/members`) and back link. `PrickleDetails` gains a `memberBasePath` prop used for all member name links. `CalendarWeekView` enables click and tooltip in member mode, navigating both modes to `/prickles/{id}`.

**Tech Stack:** Next.js 15 App Router, Supabase, TypeScript, Vitest (tests read source files as strings), Tailwind CSS

---

### Task 1: Update CalendarWeekView tests for new click behavior

The existing test "disables click navigation in member mode" will break. Update it to assert the new behavior: clicks are enabled in both modes and both navigate to `/prickles/`.

**Files:**
- Modify: `tests/components/CalendarWeekView.test.ts`

- [ ] **Step 1: Update tests**

Replace the entire file content:

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

  it('enables click navigation to /prickles/ in both modes', () => {
    expect(src).toContain('router.push(`/prickles/${prickle.id}`)');
    expect(src).not.toContain('/admin/prickles/');
  });

  it('shows tooltip in member mode', () => {
    // Tooltip must not be gated on mode
    expect(src).not.toMatch(/hoveredPrickle === prickle\.id && mode !== "member"/);
  });

  it('hides attendee count label in member mode', () => {
    expect(src).toContain('mode !== "member"');
    expect(src).toMatch(/mode !== "member"[\s\S]{0,100}text-xs font-bold/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:run -- tests/components/CalendarWeekView.test.ts
```

Expected: 2 tests FAIL — "enables click navigation" and "shows tooltip in member mode"

---

### Task 2: Update CalendarWeekView component

Enable click + tooltip in member mode, update route from `/admin/prickles/` to `/prickles/`.

**Files:**
- Modify: `components/CalendarWeekView.tsx`

- [ ] **Step 1: Enable click in both modes — update className, onClick, and onMouseEnter**

Find this block (around line 274–283):

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
  onMouseEnter={() => { if (mode !== "member") setHoveredPrickle(prickle.id); }}
  onMouseLeave={() => setHoveredPrickle(null)}
>
```

Replace with:

```tsx
<div
  className={`absolute left-1 right-1 rounded border-2 p-1.5 overflow-hidden pointer-events-auto transition-opacity cursor-pointer hover:opacity-90 ${getAttendanceColor(prickle.attendance_count)}`}
  style={{
    top: `${adjustedTop}px`,
    height: `${height}px`,
  }}
  onClick={() => router.push(`/prickles/${prickle.id}`)}
  onMouseEnter={() => setHoveredPrickle(prickle.id)}
  onMouseLeave={() => setHoveredPrickle(null)}
>
```

- [ ] **Step 2: Enable tooltip in member mode — remove mode guard**

Find (around line 300):

```tsx
{hoveredPrickle === prickle.id && mode !== "member" && (
```

Replace with:

```tsx
{hoveredPrickle === prickle.id && (
```

- [ ] **Step 3: Run tests to verify they pass**

```bash
npm run test:run -- tests/components/CalendarWeekView.test.ts
```

Expected: all 5 tests PASS

- [ ] **Step 4: Commit**

```bash
git add components/CalendarWeekView.tsx tests/components/CalendarWeekView.test.ts
git commit -m "feat: enable click and tooltip in member mode, route prickles to /prickles/"
```

---

### Task 3: Create member prickle detail page

Create the new shared prickle detail page at `app/(member)/prickles/[id]/`. Copy data-fetching from the admin page, add role detection, parameterize member links.

**Files:**
- Create: `app/(member)/prickles/[id]/PrickleDetails.tsx`
- Create: `app/(member)/prickles/[id]/page.tsx`

- [ ] **Step 1: Create PrickleDetails.tsx with memberBasePath prop**

Create `app/(member)/prickles/[id]/PrickleDetails.tsx`:

```tsx
"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

const TIMEZONES = [
  { value: "America/New_York", label: "Eastern (ET)" },
  { value: "America/Chicago", label: "Central (CT)" },
  { value: "America/Denver", label: "Mountain (MT)" },
  { value: "America/Los_Angeles", label: "Pacific (PT)" },
  { value: "UTC", label: "UTC" },
];

interface PrickleDetailsProps {
  prickle: any;
  attendanceRecords: any[];
  hostMissing: boolean;
  hostLate: boolean;
  userTimezonePreference?: string;
  memberBasePath: string;
}

export default function PrickleDetails({
  prickle,
  attendanceRecords,
  hostMissing,
  hostLate,
  userTimezonePreference = "browser",
  memberBasePath,
}: PrickleDetailsProps) {
  const [detectedTimezone, setDetectedTimezone] = useState<string | null>(null);
  useEffect(() => {
    if (userTimezonePreference === "browser") {
      setDetectedTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    }
  }, [userTimezonePreference]);

  const defaultTimezone =
    userTimezonePreference === "browser"
      ? (detectedTimezone || "America/New_York")
      : userTimezonePreference;

  const [timezone, setTimezone] = useState(defaultTimezone);

  useEffect(() => {
    setTimezone(defaultTimezone);
  }, [defaultTimezone]);

  const prickleType = prickle.prickle_types as any;
  const hostMember = prickle.host as any;
  const startTime = new Date(prickle.start_time);
  const endTime = new Date(prickle.end_time);
  const durationMinutes = Math.round((endTime.getTime() - startTime.getTime()) / 60000);

  const uniqueMembers = new Set(attendanceRecords.map(r => r.member_id || r.members?.id)).size;

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString("en-US", {
      timeZone: timezone,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  return (
    <div className="space-y-6">
      {/* Timezone Selector */}
      <div className="flex justify-end">
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

      {/* Prickle Info */}
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
        <h2 className="text-xl font-bold mb-4">Prickle Details</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-slate-600 dark:text-slate-400">Type:</span>
            <p className="font-semibold text-slate-900 dark:text-slate-100">{prickleType?.name || "Unknown"}</p>
          </div>
          <div>
            <span className="text-slate-600 dark:text-slate-400">Host:</span>
            <p className="font-semibold">
              {hostMember ? (
                <>
                  <Link href={`${memberBasePath}/${hostMember.id}`} className="text-blue-600 hover:text-blue-700 dark:text-blue-400 hover:underline">
                    {hostMember.name}
                  </Link>
                  {(hostMissing || hostLate) && (
                    <span className="ml-2" title={hostMissing ? "Host did not attend" : "Host was late (>5 min)"}>
                      ⚠️
                    </span>
                  )}
                  {hostMissing && (
                    <span className="ml-2 text-xs text-yellow-600 dark:text-yellow-400">
                      (did not attend)
                    </span>
                  )}
                  {hostLate && !hostMissing && (
                    <span className="ml-2 text-xs text-yellow-600 dark:text-yellow-400">
                      (late &gt;5 min)
                    </span>
                  )}
                </>
              ) : (
                <span className="text-slate-900 dark:text-slate-100">None</span>
              )}
            </p>
          </div>
          <div>
            <span className="text-slate-600 dark:text-slate-400">Date:</span>
            <p className="font-semibold text-slate-900 dark:text-slate-100">{formatDate(startTime)}</p>
          </div>
          <div>
            <span className="text-slate-600 dark:text-slate-400">Time:</span>
            <p className="font-semibold text-slate-900 dark:text-slate-100">
              {formatTime(startTime)} - {formatTime(endTime)}
              <span className="text-slate-500 dark:text-slate-400 ml-2">({durationMinutes} min)</span>
            </p>
          </div>
          <div>
            <span className="text-slate-600 dark:text-slate-400">Source:</span>
            <p className="font-semibold text-slate-900 dark:text-slate-100">
              {prickle.source === "calendar" ? "Google Calendar" : "Pop-Up Prickle (Zoom)"}
            </p>
          </div>
          <div>
            <span className="text-slate-600 dark:text-slate-400">Attendance:</span>
            <p className="font-semibold text-slate-900 dark:text-slate-100">
              {uniqueMembers} {uniqueMembers === 1 ? "attendee" : "attendees"}
            </p>
          </div>
        </div>
        {prickleType?.description && (
          <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
            <span className="text-slate-600 dark:text-slate-400 text-sm">Description:</span>
            <p className="text-sm text-slate-700 dark:text-slate-300 mt-1">{prickleType.description}</p>
          </div>
        )}
      </div>

      {/* Attendance List */}
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-xl font-bold">Attendees ({uniqueMembers})</h2>
          {attendanceRecords.length > uniqueMembers && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {attendanceRecords.length} total records (some members left and rejoined)
            </p>
          )}
        </div>
        {attendanceRecords.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 dark:bg-slate-800">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Member
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Join Time
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Leave Time
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Duration
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {attendanceRecords.map((record: any) => {
                  const member = record.members;
                  const joinTime = new Date(record.join_time);
                  const leaveTime = new Date(record.leave_time);
                  const attendDuration = Math.round((leaveTime.getTime() - joinTime.getTime()) / 60000);

                  return (
                    <tr key={record.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                      <td className="px-6 py-4">
                        <Link href={`${memberBasePath}/${member.id}`} className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 hover:underline">
                          {member.name}
                        </Link>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {member.email}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-700 dark:text-slate-300">
                        {formatTime(joinTime)}
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-700 dark:text-slate-300">
                        {formatTime(leaveTime)}
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-700 dark:text-slate-300">
                        {attendDuration} min
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-12 text-center text-slate-500 dark:text-slate-400">
            No attendance records for this prickle
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create page.tsx**

Create `app/(member)/prickles/[id]/page.tsx`:

```tsx
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import PrickleDetails from "./PrickleDetails";
import { getUserTimezonePreference } from "@/lib/timezone";

export default async function PrickleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  const isAdmin = profile?.role === "admin";
  const memberBasePath = isAdmin ? "/admin/members" : "/members";
  const backHref = isAdmin ? "/admin/calendar" : "/calendar";

  const { data: prickle } = await supabase
    .from("prickles")
    .select(`
      id,
      host:members(id, name),
      start_time,
      end_time,
      source,
      zoom_meeting_uuid,
      type_id,
      prickle_types:type_id(name, description)
    `)
    .eq("id", id)
    .single();

  if (!prickle) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">Prickle not found</h1>
          <Link href={backHref} className="text-blue-600 hover:text-blue-700 dark:text-blue-400">
            ← Back to Calendar
          </Link>
        </div>
      </div>
    );
  }

  const { data: attendanceRecords } = await supabase
    .from("prickle_attendance")
    .select(`
      id,
      join_time,
      leave_time,
      confidence_score,
      member_id,
      members!inner(id, name, email)
    `)
    .eq("prickle_id", id)
    .order("join_time", { ascending: true });

  const host = Array.isArray(prickle.host) ? prickle.host[0] : prickle.host;
  const hostId = host?.id;
  let hostMissing = false;
  let hostLate = false;

  if (hostId) {
    const hostAttendance = attendanceRecords?.find((a: any) => a.member_id === hostId);
    if (!hostAttendance) {
      hostMissing = true;
    } else {
      const prickleStart = new Date(prickle.start_time);
      const hostJoin = new Date(hostAttendance.join_time);
      if (hostJoin.getTime() - prickleStart.getTime() > 5 * 60 * 1000) {
        hostLate = true;
      }
    }
  }

  const userTimezone = await getUserTimezonePreference();

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <Link href={backHref} className="text-blue-600 hover:text-blue-700 dark:text-blue-400 text-sm mb-2 inline-block">
            ← Back to Calendar
          </Link>
          <h1 className="text-2xl font-bold mt-2">Prickle Details</h1>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <div className="max-w-4xl mx-auto">
          <PrickleDetails
            prickle={prickle}
            attendanceRecords={attendanceRecords || []}
            hostMissing={hostMissing}
            hostLate={hostLate}
            userTimezonePreference={userTimezone}
            memberBasePath={memberBasePath}
          />
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add "app/(member)/prickles/[id]/PrickleDetails.tsx" "app/(member)/prickles/[id]/page.tsx"
git commit -m "feat: add shared /prickles/[id] page with role-aware member links"
```

---

### Task 4: Fix existing admin links pointing to /admin/prickles/{id}

Three files still reference `/admin/prickles/`. Update each to `/prickles/`.

**Files:**
- Modify: `app/(admin)/admin/hygiene/unmatched-zoom/AliasSearchForm.tsx:307`
- Modify: `app/(admin)/admin/members/[id]/AttendanceCalendar.tsx:195`
- Modify: `app/(admin)/admin/members/[id]/MemberDetails.tsx:655`

- [ ] **Step 1: Fix AliasSearchForm.tsx**

At line 307, change:

```tsx
href={`/admin/prickles/${prickle.id}`}
```

To:

```tsx
href={`/prickles/${prickle.id}`}
```

- [ ] **Step 2: Fix AttendanceCalendar.tsx**

At line 195, change:

```tsx
onClick={() => router.push(`/admin/prickles/${prickle.id}`)}
```

To:

```tsx
onClick={() => router.push(`/prickles/${prickle.id}`)}
```

- [ ] **Step 3: Fix MemberDetails.tsx**

At line 655, change:

```tsx
onClick={() => router.push(`/admin/prickles/${prickle.id}`)}
```

To:

```tsx
onClick={() => router.push(`/prickles/${prickle.id}`)}
```

- [ ] **Step 4: Verify no remaining /admin/prickles/{id} references**

```bash
grep -r "admin/prickles" app components --include="*.tsx" --include="*.ts"
```

Expected: only `AdminNavigation.tsx` with `/admin/prickles` (the list page — correct, leave it)

- [ ] **Step 5: Commit**

```bash
git add "app/(admin)/admin/hygiene/unmatched-zoom/AliasSearchForm.tsx" \
        "app/(admin)/admin/members/[id]/AttendanceCalendar.tsx" \
        "app/(admin)/admin/members/[id]/MemberDetails.tsx"
git commit -m "fix: update admin links from /admin/prickles/{id} to /prickles/{id}"
```

---

### Task 5: Delete old admin prickle detail page

**Files:**
- Delete: `app/(admin)/admin/prickles/[id]/page.tsx`
- Delete: `app/(admin)/admin/prickles/[id]/PrickleDetails.tsx`

- [ ] **Step 1: Delete the files**

```bash
rm "app/(admin)/admin/prickles/[id]/page.tsx"
rm "app/(admin)/admin/prickles/[id]/PrickleDetails.tsx"
rmdir "app/(admin)/admin/prickles/[id]"
```

- [ ] **Step 2: Verify the admin prickles list page still exists**

```bash
ls "app/(admin)/admin/prickles/"
```

Expected: `page.tsx` still present (the list page is not deleted)

- [ ] **Step 3: Run all tests**

```bash
npm run test:run
```

Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove old /admin/prickles/[id] page (moved to /prickles/[id])"
```
