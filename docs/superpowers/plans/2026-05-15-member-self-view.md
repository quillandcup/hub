# Member Self View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/members/[id]` — a member-facing profile page that shows basic stats to all members (Tier 3) and adds streaks + prickle history when the viewer is the profile owner (Tier 2).

**Architecture:** Pure streak-computation utility → server-rendered Next.js page within the `(member)` layout → sidebar nav update to expose the route. No new API routes, client components, or DB migrations.

**Tech Stack:** Next.js 15 App Router (server components), Supabase (server client), Vitest for unit tests, Tailwind CSS.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `lib/streaks.ts` | **Create** | Pure function: compute current + longest attendance streaks from ISO timestamps |
| `tests/lib/streaks.test.ts` | **Create** | Unit tests for streak computation |
| `app/(member)/members/[id]/page.tsx` | **Create** | Profile page: Tier 3 (all) + Tier 2 (self only) |
| `components/MemberNavigation.tsx` | **Modify** | Add `memberId` prop; add "My Profile" nav link |
| `app/(member)/layout.tsx` | **Modify** | Pass `effectiveIdentity.memberId` to `MemberNavigation` |

---

## Task 1: Streak computation utility

**Files:**
- Create: `lib/streaks.ts`
- Create: `tests/lib/streaks.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/streaks.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { computeStreaks } from '@/lib/streaks'

// Helpers: build ISO timestamps N weeks apart from a fixed anchor
const ANCHOR_MS = new Date('2026-01-05T12:00:00Z').getTime() // a Monday
const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000

function weeksAgo(n: number): string {
  return new Date(ANCHOR_MS - n * MS_PER_WEEK).toISOString()
}

describe('computeStreaks', () => {
  it('returns zeros for empty input', () => {
    expect(computeStreaks([])).toEqual({ currentStreak: 0, longestStreak: 0 })
  })

  it('returns 1/1 for a single attendance', () => {
    expect(computeStreaks([weeksAgo(0)])).toEqual({ currentStreak: 1, longestStreak: 1 })
  })

  it('deduplicates multiple attendances in the same week', () => {
    // Two timestamps in the same week
    const t1 = weeksAgo(0)
    const t2 = new Date(new Date(t1).getTime() + 3 * 24 * 60 * 60 * 1000).toISOString()
    expect(computeStreaks([t1, t2])).toEqual({ currentStreak: 1, longestStreak: 1 })
  })

  it('counts consecutive weeks as a streak', () => {
    expect(
      computeStreaks([weeksAgo(2), weeksAgo(1), weeksAgo(0)])
    ).toEqual({ currentStreak: 3, longestStreak: 3 })
  })

  it('currentStreak is 1 when last two weeks are not consecutive', () => {
    // weeks 4 ago and 0 ago — gap in between
    expect(
      computeStreaks([weeksAgo(4), weeksAgo(0)])
    ).toEqual({ currentStreak: 1, longestStreak: 1 })
  })

  it('currentStreak stops at the gap from the most recent week', () => {
    // Streak of 3 (weeks 5,4,3 ago), gap, then streak of 2 (weeks 1,0 ago)
    expect(
      computeStreaks([weeksAgo(5), weeksAgo(4), weeksAgo(3), weeksAgo(1), weeksAgo(0)])
    ).toEqual({ currentStreak: 2, longestStreak: 3 })
  })

  it('longestStreak finds the max run', () => {
    // Streak of 4 (weeks 8–5 ago), gap, streak of 2 (weeks 2–1 ago), isolated (week 0)
    expect(
      computeStreaks([
        weeksAgo(8), weeksAgo(7), weeksAgo(6), weeksAgo(5),
        weeksAgo(2), weeksAgo(1),
        weeksAgo(0),
      ])
    ).toEqual({ currentStreak: 1, longestStreak: 4 })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/cody/codyaray/git/quillandcup/hub && npx vitest run tests/lib/streaks.test.ts
```

Expected: all tests fail with "Cannot find module '@/lib/streaks'".

- [ ] **Step 3: Implement `lib/streaks.ts`**

```typescript
export interface Streaks {
  currentStreak: number
  longestStreak: number
}

function weekIndex(isoTimestamp: string): number {
  const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000
  return Math.floor(new Date(isoTimestamp).getTime() / MS_PER_WEEK)
}

export function computeStreaks(joinTimes: string[]): Streaks {
  if (joinTimes.length === 0) return { currentStreak: 0, longestStreak: 0 }

  const weeks = [...new Set(joinTimes.map(weekIndex))].sort((a, b) => a - b)

  let longestStreak = 1
  let run = 1
  for (let i = 1; i < weeks.length; i++) {
    if (weeks[i] === weeks[i - 1] + 1) {
      run++
      if (run > longestStreak) longestStreak = run
    } else {
      run = 1
    }
  }

  let currentStreak = 1
  for (let i = weeks.length - 2; i >= 0; i--) {
    if (weeks[i] === weeks[i + 1] - 1) {
      currentStreak++
    } else {
      break
    }
  }

  return { currentStreak, longestStreak }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/cody/codyaray/git/quillandcup/hub && npx vitest run tests/lib/streaks.test.ts
```

Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/streaks.ts tests/lib/streaks.test.ts
git commit -m "feat: add streak computation utility"
```

---

## Task 2: `/members/[id]` profile page

**Files:**
- Create: `app/(member)/members/[id]/page.tsx`

- [ ] **Step 1: Create the page**

Create `app/(member)/members/[id]/page.tsx`:

```typescript
import { createClient } from "@/lib/supabase/server"
import { redirect, notFound } from "next/navigation"
import { getEffectiveIdentity } from "@/lib/sudo"
import { computeStreaks } from "@/lib/streaks"

export default async function MemberProfilePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const supabase = await createClient()
  const { id } = await params

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const effectiveIdentity = await getEffectiveIdentity(user)
  if (!effectiveIdentity) redirect("/admin")

  const isSelf = effectiveIdentity.memberId === id

  const [{ data: member }, { data: metrics }] = await Promise.all([
    supabase.from("members").select("id, name, email, joined_at, status").eq("id", id).single(),
    supabase.from("member_metrics").select("*").eq("member_id", id).single(),
  ])

  if (!member) notFound()

  let attendance: { join_time: string; leave_time: string; prickles: { start_time: string; prickle_types: { name: string } | null } | null }[] = []
  if (isSelf) {
    const { data } = await supabase
      .from("prickle_attendance")
      .select("join_time, leave_time, prickles(start_time, prickle_types(name))")
      .eq("member_id", id)
      .order("join_time", { ascending: false })
      .limit(50)
    attendance = (data ?? []) as typeof attendance
  }

  const streaks = computeStreaks(attendance.map((a) => a.join_time))

  const joinedYear = new Date(member.joined_at).getFullYear()
  const joinedMonth = new Date(member.joined_at).toLocaleString("en-US", { month: "long" })

  const statusColors: Record<string, string> = {
    active: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    on_hiatus: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    inactive: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  }
  const statusLabel: Record<string, string> = {
    active: "Active",
    on_hiatus: "On Hiatus",
    inactive: "Inactive",
  }

  return (
    <div className="container mx-auto px-6 py-8 max-w-2xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold">{member.name}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Member since {joinedMonth} {joinedYear}
        </p>
      </div>

      {/* Tier 3: visible to all */}
      <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6 mb-6">
        <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-4">
          Community Stats
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-3xl font-bold">{metrics?.total_sessions ?? 0}</span>
          <span className="text-slate-500 dark:text-slate-400">prickles attended</span>
        </div>
      </div>

      {/* Tier 2: self only */}
      {isSelf && (
        <>
          {/* Account info */}
          <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6 mb-6">
            <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-4">
              Account
            </h2>
            <div className="space-y-3">
              <div>
                <span className="text-xs text-slate-500 dark:text-slate-400">Email</span>
                <p className="text-sm font-medium">{member.email}</p>
              </div>
              <div>
                <span className="text-xs text-slate-500 dark:text-slate-400">Status</span>
                <div className="mt-1">
                  <span
                    className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                      statusColors[member.status] ?? statusColors.inactive
                    }`}
                  >
                    {statusLabel[member.status] ?? member.status}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Engagement metrics */}
          <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6 mb-6">
            <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-4">
              Engagement
            </h2>
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="text-center">
                <p className="text-2xl font-bold">{metrics?.sessions_last_7_days ?? 0}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Last 7 days</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold">{metrics?.sessions_last_30_days ?? 0}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Last 30 days</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold">{metrics?.total_sessions ?? 0}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">All time</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 border-t border-slate-100 dark:border-slate-800 pt-4">
              <div className="text-center">
                <p className="text-2xl font-bold">{streaks.currentStreak}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {streaks.currentStreak === 1 ? "week" : "weeks"} current streak
                </p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold">{streaks.longestStreak}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {streaks.longestStreak === 1 ? "week" : "weeks"} best streak
                </p>
              </div>
            </div>
          </div>

          {/* Prickle history */}
          <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6">
            <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-4">
              Prickle History{attendance.length === 50 ? " (last 50)" : ""}
            </h2>
            {attendance.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">No prickles attended yet.</p>
            ) : (
              <div className="space-y-2">
                {attendance.map((record, i) => {
                  const joinDate = new Date(record.join_time)
                  const durationMin = Math.round(
                    (new Date(record.leave_time).getTime() - joinDate.getTime()) / 60000
                  )
                  const prickleName = record.prickles?.prickle_types?.name ?? "Prickle"
                  const dateStr = joinDate.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })
                  return (
                    <div
                      key={i}
                      className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800 last:border-0"
                    >
                      <div>
                        <span className="text-sm font-medium">{prickleName}</span>
                        <span className="text-xs text-slate-500 dark:text-slate-400 ml-2">{dateStr}</span>
                      </div>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {durationMin} min
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Start the dev server and verify the page loads**

```bash
cd /Users/cody/codyaray/git/quillandcup/hub && npm run dev
```

In a browser, navigate to `/members/<your-own-member-id>`. Confirm:
- Name and "Member since" appear in the header
- "Community Stats" section shows total prickles attended
- "Account", "Engagement", and "Prickle History" sections are visible (self-view)

Navigate to a different member's id. Confirm only "Community Stats" is visible.

Navigate to a non-existent UUID. Confirm 404.

- [ ] **Step 3: Commit**

```bash
git add app/\(member\)/members/
git commit -m "feat: add /members/[id] profile page (Tier 2 + Tier 3)"
```

---

## Task 3: Add "My Profile" nav link

**Files:**
- Modify: `components/MemberNavigation.tsx`
- Modify: `app/(member)/layout.tsx`

- [ ] **Step 1: Update `MemberNavigation` to accept and use `memberId`**

In `components/MemberNavigation.tsx`, update the interface and add the nav link:

```typescript
interface MemberNavigationProps {
  isAdmin: boolean
  memberId: string
}

export default function MemberNavigation({ isAdmin, memberId }: MemberNavigationProps) {
  const [collapsed, setCollapsed] = useState(true);
  const pathname = usePathname();

  useEffect(() => {
    const isMobile = window.innerWidth < 768;
    setCollapsed(isMobile);
    const handleResize = () => setCollapsed(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isCalendarActive = pathname === '/calendar';
  const isProfileActive = pathname.startsWith('/members/');

  return (
    <aside
      className={`flex-shrink-0 h-screen bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 transition-all duration-300 z-10 flex flex-col ${
        collapsed ? "w-16" : "w-64"
      }`}
    >
      {/* Header */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-slate-200 dark:border-slate-800 flex-shrink-0">
        {!collapsed && (
          <h1 className="text-lg font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            Quill &amp; Cup
          </h1>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors relative z-20"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? "→" : "←"}
        </button>
      </div>

      {/* Nav items */}
      <nav className="p-4 flex-1 space-y-1">
        <Link
          href="/calendar"
          className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
            isCalendarActive
              ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium"
              : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          }`}
          title={collapsed ? "My Calendar" : undefined}
        >
          <span className="text-lg">📅</span>
          {!collapsed && <span>My Calendar</span>}
        </Link>

        <Link
          href={`/members/${memberId}`}
          className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
            isProfileActive
              ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium"
              : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          }`}
          title={collapsed ? "My Profile" : undefined}
        >
          <span className="text-lg">👤</span>
          {!collapsed && <span>My Profile</span>}
        </Link>
      </nav>

      {/* Admin Portal — fixed at bottom, admin-only */}
      {isAdmin && (
        <div className="px-2 py-3 border-t border-slate-200 dark:border-slate-800 flex-shrink-0">
          <Link
            href="/admin"
            className="flex items-center justify-center gap-2 px-2 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            title="Admin Portal"
          >
            <span className="text-base flex-shrink-0">⚙️</span>
            {!collapsed && <span className="text-sm whitespace-nowrap">Admin Portal →</span>}
          </Link>
        </div>
      )}
    </aside>
  )
}
```

- [ ] **Step 2: Pass `memberId` to `MemberNavigation` in the layout**

In `app/(member)/layout.tsx`, update the `MemberNavigation` usage. The `effectiveIdentity` is already resolved and guaranteed non-null by the redirect above it:

```typescript
<MemberNavigation isAdmin={isAdmin} memberId={effectiveIdentity.memberId} />
```

The full updated return in `app/(member)/layout.tsx` (only the JSX changes — the data-fetching logic above stays identical):

```typescript
  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 dark:bg-slate-950">
      <MemberNavigation isAdmin={isAdmin} memberId={effectiveIdentity.memberId} />
      <div className="flex flex-col flex-1 min-w-0">
        {effectiveIdentity.isSudo && (
          <SudoBanner
            memberName={effectiveIdentity.memberName}
            memberEmail={effectiveIdentity.memberEmail}
          />
        )}
        <header className="h-16 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-end px-6 flex-shrink-0 relative z-30">
          <UserMenu
            userEmail={effectiveIdentity.memberName}
            isAdmin={isAdmin}
            isSudo={effectiveIdentity.isSudo}
            members={members}
          />
        </header>
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  )
```

- [ ] **Step 3: Verify nav in browser**

With the dev server running, navigate to `/calendar`. Confirm:
- "My Calendar" and "My Profile" nav links appear in the sidebar
- "My Profile" links to `/members/<your-member-id>`
- Clicking "My Profile" highlights it and loads the profile page correctly
- Clicking "My Calendar" highlights it and loads the calendar correctly
- Collapsed sidebar shows both emoji icons with correct tooltips

- [ ] **Step 4: Commit**

```bash
git add components/MemberNavigation.tsx app/\(member\)/layout.tsx
git commit -m "feat: add My Profile nav link to member sidebar"
```

---

## Task 4: Mark TODOs complete in the spec

**Files:**
- Modify: `docs/superpowers/specs/2026-05-15-my-attendance-and-member-pages-design.md`

- [ ] **Step 1: Mark the completed TODOs**

In `docs/superpowers/specs/2026-05-15-my-attendance-and-member-pages-design.md`, update the TODOs section:

```markdown
## TODOs (deferred)

- [ ] **Kajabi bronze import:** Add bio, location, instagram_url, facebook_url, twitter_url, share_with_members to bronze import and `members` silver table.
- [x] **`/members/[id]` Tier 3 MVP:** Build the route, page, and left-nav link. ✅ 2026-05-15
- [x] **Tier 2 self-view:** Add streaks and personal prickle history to `/members/[id]` when viewer is the owner. ✅ 2026-05-15
- [ ] **Prickle card click:** Make cards clickable in `CalendarWeekView` member mode; link to a member-facing prickle detail page.
- [ ] **Prickle detail page (member-facing):** Lightweight page showing type, date, time, duration, attendee count. No sensitive member data.
- [ ] **Tier 4 public author profile:** Separate route (TBD), configurable fields, links to Amazon/Goodreads.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-05-15-my-attendance-and-member-pages-design.md
git commit -m "docs: mark Tier 2/3 member self view TODOs complete"
```
