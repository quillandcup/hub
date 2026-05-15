# Admin / Member Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the app into a member section (`/*`) and admin section (`/admin/*`) with role-based access enforced at the layout and API handler levels.

**Architecture:** Next.js route groups `(member)` and `(admin)` provide separate layouts without affecting URL paths. The admin layout does a server-side role check and renders a 403 page for non-admins. Middleware is expanded to require auth on all non-public routes. A `requireAdmin()` helper in `api-auth.ts` consolidates the inconsistent per-handler auth patterns into one call.

**Tech Stack:** Next.js 15 App Router, Supabase SSR (`@supabase/ssr`), TypeScript, Tailwind CSS, Vitest

---

## File Map

```
CREATED
  app/(member)/layout.tsx
  app/(member)/calendar/page.tsx               ← new: personal attendance calendar
  app/(admin)/layout.tsx
  app/(admin)/admin/AdminNavigation.tsx
  components/MemberNavigation.tsx
  supabase/migrations/20260514000001_change_role_default_to_member.sql

MOVED (content unchanged unless noted)
  app/dashboard/UserMenu.tsx        → components/UserMenu.tsx            (update: profile href, SignOutButton import)
  app/dashboard/SignOutButton.tsx   → components/SignOutButton.tsx
  app/calendar/CalendarWeekView.tsx → components/CalendarWeekView.tsx
  app/dashboard/profile/            → app/(member)/profile/              (no import changes needed)
  app/dashboard/page.tsx            → app/(admin)/admin/page.tsx
  app/dashboard/DashboardCharts.tsx → app/(admin)/admin/DashboardCharts.tsx
  app/dashboard/members/            → app/(admin)/admin/members/
  app/dashboard/at-risk/            → app/(admin)/admin/at-risk/
  app/dashboard/hiatus/             → app/(admin)/admin/hiatus/
  app/dashboard/member-overrides/   → app/(admin)/admin/member-overrides/
  app/dashboard/reconciliation/     → app/(admin)/admin/reconciliation/
  app/dashboard/prickles/           → app/(admin)/admin/prickles/
  app/calendar/page.tsx             → app/(admin)/admin/calendar/page.tsx (update: CalendarWeekView import)
  app/data/                         → app/(admin)/admin/data/
  app/hygiene/                      → app/(admin)/admin/hygiene/
  app/prd/                          → app/(admin)/admin/prd/

MODIFIED
  middleware.ts                     ← expand protected routes beyond /dashboard
  lib/supabase/api-auth.ts          ← add requireAdmin()
  app/page.tsx                      ← redirect by role (admin→/admin, member→/calendar)
  tests/components/UserMenu.test.ts ← update path + href assertion

DELETED
  app/dashboard/layout.tsx
  app/dashboard/Navigation.tsx
  app/calendar/layout.tsx
  app/data/layout.tsx
  app/hygiene/layout.tsx

API HANDLERS — add requireAdmin() (33 files, see Task 11)
  All handlers under app/api/ except app/api/webhooks/*
```

---

## Task 1: DB Migration — Change Role Default to `member`

**Files:**
- Create: `supabase/migrations/20260514000001_change_role_default_to_member.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Change default role for new signups from 'admin' to 'member'.
-- Existing rows are unaffected (no UPDATE).
-- The trigger create_user_profile() INSERT uses the column default,
-- so updating the default is sufficient.

ALTER TABLE user_profiles
  ALTER COLUMN role SET DEFAULT 'member';

-- Update the trigger function to explicitly insert 'member'
-- so the intent is clear even if the column default changes later.
CREATE OR REPLACE FUNCTION create_user_profile()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO user_profiles (id, email, role)
    VALUES (NEW.id, NEW.email, 'member')
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

- [ ] **Step 2: Apply migration**

```bash
npx supabase db push
```

Expected: migration applied with no errors.

- [ ] **Step 3: Verify**

In the Supabase dashboard (or via psql), confirm:
```sql
SELECT column_default FROM information_schema.columns
WHERE table_name = 'user_profiles' AND column_name = 'role';
-- Expected: 'member'::text
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260514000001_change_role_default_to_member.sql
git commit -m "chore: change user_profiles role default from admin to member"
```

---

## Task 2: Add `requireAdmin()` to `api-auth.ts`

**Files:**
- Modify: `lib/supabase/api-auth.ts`

- [ ] **Step 1: Write the test first**

Create `tests/api/require-admin.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// We test requireAdmin by mocking createApiAuth's dependencies.
// The function under test is exported from api-auth.ts.

// Mock the supabase server client
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

import { requireAdmin } from '@/lib/supabase/api-auth'
import { createClient } from '@/lib/supabase/server'

function makeRequest(authHeader?: string): NextRequest {
  const headers: Record<string, string> = {}
  if (authHeader) headers['authorization'] = authHeader
  return new NextRequest('http://localhost/api/test', { headers })
}

function makeSupabaseMock(user: any, role: string | null) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user } }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: role ? { role } : null,
        error: null,
      }),
    }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-secret'
})

describe('requireAdmin', () => {
  it('returns forbidden=true when no user session', async () => {
    const mockSupabase = makeSupabaseMock(null, null)
    vi.mocked(createClient).mockResolvedValue(mockSupabase as any)

    const result = await requireAdmin(makeRequest())
    expect(result.user).toBeNull()
    expect(result.forbidden).toBe(true)
  })

  it('returns forbidden=true for authenticated member (non-admin)', async () => {
    const mockSupabase = makeSupabaseMock({ id: 'user-1', email: 'a@b.com' }, 'member')
    vi.mocked(createClient).mockResolvedValue(mockSupabase as any)

    const result = await requireAdmin(makeRequest())
    expect(result.user).not.toBeNull()
    expect(result.forbidden).toBe(true)
  })

  it('returns forbidden=false for authenticated admin', async () => {
    const mockSupabase = makeSupabaseMock({ id: 'user-1', email: 'a@b.com' }, 'admin')
    vi.mocked(createClient).mockResolvedValue(mockSupabase as any)

    const result = await requireAdmin(makeRequest())
    expect(result.forbidden).toBe(false)
  })

  it('returns forbidden=false for service-role key (test bypass)', async () => {
    // Service role key in Authorization header bypasses role check
    const result = await requireAdmin(makeRequest('Bearer service-role-secret'))
    expect(result.user?.id).toBe('service-role')
    expect(result.forbidden).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/api/require-admin.test.ts
```

Expected: 4 failures — `requireAdmin` does not exist yet.

- [ ] **Step 3: Implement `requireAdmin` in `api-auth.ts`**

The full updated file:

```ts
import { createClient } from "@/lib/supabase/server";
import { createClient as createDirectClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

export async function createApiAuth(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const isServiceRole =
    authHeader && serviceRoleKey && authHeader.includes(serviceRoleKey);

  if (isServiceRole) {
    const supabase = createDirectClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    return { supabase, user: { id: "service-role" } as const };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { supabase, user };
}

export async function requireAdmin(request: NextRequest) {
  const auth = await createApiAuth(request);
  if (!auth.user) return { ...auth, forbidden: true as const };
  // Service-role key used by integration tests bypasses role check
  if (auth.user.id === "service-role") return { ...auth, forbidden: false as const };
  const { data: profile } = await auth.supabase
    .from("user_profiles")
    .select("role")
    .eq("id", auth.user.id)
    .single();
  if (profile?.role !== "admin") return { ...auth, forbidden: true as const };
  return { ...auth, forbidden: false as const };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run tests/api/require-admin.test.ts
```

Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add lib/supabase/api-auth.ts tests/api/require-admin.test.ts
git commit -m "feat: add requireAdmin() helper to api-auth"
```

---

## Task 3: Expand Middleware to Protect All Non-Public Routes

**Files:**
- Modify: `middleware.ts`

Currently only `/dashboard` is protected. Every route except `/login`, `/auth/*`, `/api/webhooks/*`, and static assets needs auth.

- [ ] **Step 1: Update `lib/supabase/middleware.ts`**

```ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // Public routes — no auth required
  const isPublic =
    pathname === '/login' ||
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/api/webhooks/')

  if (!user && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
```

- [ ] **Step 2: Update `middleware.ts` matcher to include all routes**

```ts
import { type NextRequest } from 'next/server'
import { updateSession } from './lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
```

(The matcher is unchanged — it already covers all non-static paths. The logic change is in `updateSession`.)

- [ ] **Step 3: Verify existing auth tests still pass**

```bash
npx vitest run tests/api/
```

Expected: all pass (service-role bypass is unaffected).

- [ ] **Step 4: Commit**

```bash
git add middleware.ts lib/supabase/middleware.ts
git commit -m "feat: expand middleware to require auth on all non-public routes"
```

---

## Task 4: Move Shared Components to `components/`

`UserMenu`, `SignOutButton`, and `CalendarWeekView` are used by both member and admin layouts. Move them to `components/` and update their imports and tests.

**Files:**
- Move: `app/dashboard/UserMenu.tsx` → `components/UserMenu.tsx`
- Move: `app/dashboard/SignOutButton.tsx` → `components/SignOutButton.tsx`
- Move: `app/calendar/CalendarWeekView.tsx` → `components/CalendarWeekView.tsx`
- Modify: `components/UserMenu.tsx` — update `SignOutButton` import + profile href
- Modify: `tests/components/UserMenu.test.ts`

- [ ] **Step 1: Move files**

```bash
mv app/dashboard/UserMenu.tsx components/UserMenu.tsx
mv app/dashboard/SignOutButton.tsx components/SignOutButton.tsx
mv app/calendar/CalendarWeekView.tsx components/CalendarWeekView.tsx
```

- [ ] **Step 2: Update `components/UserMenu.tsx`**

Two changes: `SignOutButton` import path and the profile link href.

```ts
"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import SignOutButton from "./SignOutButton";

interface UserMenuProps {
  userEmail: string;
}

export default function UserMenu({ userEmail }: UserMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-2 md:px-3 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
      >
        <div className="w-8 h-8 rounded-full bg-gradient-to-r from-blue-600 to-purple-600 flex items-center justify-center text-white font-semibold text-sm">
          {userEmail.charAt(0).toUpperCase()}
        </div>
        <span className="hidden md:inline text-sm text-slate-700 dark:text-slate-300">{userEmail}</span>
        <svg
          className={`hidden md:block w-4 h-4 text-slate-500 transition-transform ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 py-1 z-50">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Signed in as</p>
            <p className="text-sm text-slate-500 dark:text-slate-400 truncate">{userEmail}</p>
          </div>

          <Link
            href="/profile"
            className="block px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            onClick={() => setIsOpen(false)}
          >
            Profile
          </Link>

          <SignOutButton onSignOut={() => setIsOpen(false)} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Update `tests/components/UserMenu.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('UserMenu Component', () => {
  const userMenuPath = path.join(process.cwd(), 'components/UserMenu.tsx');
  const userMenuContent = fs.readFileSync(userMenuPath, 'utf-8');

  it('should have a Profile link', () => {
    expect(userMenuContent).toContain('Profile');
  });

  it('should link Profile to /profile', () => {
    expect(userMenuContent).toContain('href="/profile"');
  });

  it('should include SignOutButton', () => {
    expect(userMenuContent).toContain('SignOutButton');
    expect(userMenuContent).toContain('<SignOutButton');
  });

  it('should have a dropdown menu structure', () => {
    expect(userMenuContent).toContain('Signed in as');
    expect(userMenuContent).toContain('isOpen');
  });
});
```

- [ ] **Step 4: Run UserMenu tests**

```bash
npx vitest run tests/components/UserMenu.test.ts
```

Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add components/UserMenu.tsx components/SignOutButton.tsx components/CalendarWeekView.tsx tests/components/UserMenu.test.ts
git commit -m "refactor: move shared components (UserMenu, SignOutButton, CalendarWeekView) to components/"
```

---

## Task 5: Create Admin Route Group — Layout + Navigation

**Files:**
- Create: `app/(admin)/layout.tsx`
- Create: `app/(admin)/admin/AdminNavigation.tsx`

- [ ] **Step 1: Write `app/(admin)/admin/AdminNavigation.tsx`**

This is the existing `Navigation.tsx` with all hrefs updated to `/admin/*` and a "← My View" link added at the top.

```tsx
"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavItem {
  name: string;
  href: string;
  icon?: string;
}

interface NavSection {
  name: string;
  items: NavItem[];
}

const navigation: NavSection[] = [
  {
    name: "Overview",
    items: [
      { name: "Dashboard", href: "/admin", icon: "📊" },
    ],
  },
  {
    name: "Members",
    items: [
      { name: "All Members", href: "/admin/members", icon: "👥" },
      { name: "At-Risk Members", href: "/admin/at-risk", icon: "⚠️" },
      { name: "Hiatus Tracking", href: "/admin/hiatus", icon: "⏸️" },
      { name: "Network", href: "/admin/members/network", icon: "🕸️" },
    ],
  },
  {
    name: "Prickles",
    items: [
      { name: "Calendar View", href: "/admin/calendar", icon: "📅" },
      { name: "All Prickles", href: "/admin/prickles", icon: "✍️" },
    ],
  },
  {
    name: "Data Hygiene",
    items: [
      { name: "Health Check", href: "/admin/hygiene", icon: "🏥" },
      { name: "Unmatched Events", href: "/admin/hygiene/unmatched-events", icon: "📋" },
      { name: "Unmatched Zoom", href: "/admin/hygiene/unmatched-zoom", icon: "🔍" },
      { name: "Name Matching", href: "/admin/hygiene/name-matching", icon: "🧩" },
    ],
  },
  {
    name: "Data Management",
    items: [
      { name: "Import Data", href: "/admin/data/import", icon: "📥" },
      { name: "Prickle Types", href: "/admin/data/prickle-types", icon: "🏷️" },
      { name: "Name Aliases", href: "/admin/data/aliases", icon: "👤" },
      { name: "Member Overrides", href: "/admin/member-overrides", icon: "🎁" },
      { name: "Reconciliation", href: "/admin/reconciliation", icon: "🔄" },
    ],
  },
];

export default function AdminNavigation() {
  const [collapsed, setCollapsed] = useState(true);
  const pathname = usePathname();

  useEffect(() => {
    const isMobile = window.innerWidth < 768;
    setCollapsed(isMobile);
    const handleResize = () => setCollapsed(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <aside
      className={`flex-shrink-0 h-screen bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 transition-all duration-300 z-10 flex flex-col ${
        collapsed ? "w-16" : "w-64"
      }`}
    >
      {/* Header */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-slate-200 dark:border-slate-800 flex-shrink-0">
        {!collapsed && (
          <h1 className="text-lg font-bold text-slate-500 dark:text-slate-400">
            ⚙️ Admin
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

      {/* Back to member view */}
      <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-800 flex-shrink-0">
        <Link
          href="/calendar"
          className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
          title={collapsed ? "My View" : undefined}
        >
          <span>←</span>
          {!collapsed && <span>My View</span>}
        </Link>
      </div>

      {/* Navigation */}
      <nav className="p-4 overflow-y-auto flex-1">
        {navigation.map((section) => (
          <div key={section.name} className="mb-6">
            {!collapsed && (
              <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 px-3">
                {section.name}
              </h2>
            )}
            <ul className="space-y-1">
              {section.items.map((item) => {
                const isActive =
                  pathname === item.href ||
                  (item.href !== "/admin" && pathname?.startsWith(item.href));
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                        isActive
                          ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium"
                          : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                      }`}
                      title={collapsed ? item.name : undefined}
                    >
                      {item.icon && <span className="text-lg">{item.icon}</span>}
                      {!collapsed && <span>{item.name}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 2: Write `app/(admin)/layout.tsx`**

Server component: checks role, renders 403 page if not admin, otherwise renders admin shell with nav.

```tsx
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AdminNavigation from "./admin/AdminNavigation";
import UserMenu from "@/components/UserMenu";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">
            Access Denied
          </h1>
          <p className="text-slate-600 dark:text-slate-400 mb-4">
            You don&apos;t have permission to access the admin area.
          </p>
          <a
            href="/calendar"
            className="text-blue-600 dark:text-blue-400 hover:underline"
          >
            ← Return to my view
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950">
      <AdminNavigation />
      <div className="flex flex-col flex-1 min-w-0">
        <header className="h-16 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-end px-6 flex-shrink-0 relative z-30">
          <UserMenu userEmail={user.email || "User"} />
        </header>
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors (pages don't exist under the admin group yet, so no 404s from missing imports).

- [ ] **Step 4: Commit**

```bash
git add app/\(admin\)/layout.tsx app/\(admin\)/admin/AdminNavigation.tsx
git commit -m "feat: add admin route group with layout and AdminNavigation"
```

---

## Task 6: Move All Admin Pages Into `(admin)/admin/`

Batch file move of all existing admin page files. These files use `@/` absolute imports for lib/supabase/server etc., so those imports are unaffected. The one exception is `app/calendar/page.tsx`, which imports `CalendarWeekView` with a relative path — update that import.

**Files to move:**

```
app/dashboard/page.tsx            → app/(admin)/admin/page.tsx
app/dashboard/DashboardCharts.tsx → app/(admin)/admin/DashboardCharts.tsx
app/dashboard/members/            → app/(admin)/admin/members/
app/dashboard/at-risk/            → app/(admin)/admin/at-risk/
app/dashboard/hiatus/             → app/(admin)/admin/hiatus/
app/dashboard/member-overrides/   → app/(admin)/admin/member-overrides/
app/dashboard/reconciliation/     → app/(admin)/admin/reconciliation/
app/dashboard/prickles/           → app/(admin)/admin/prickles/
app/calendar/page.tsx             → app/(admin)/admin/calendar/page.tsx
app/data/                         → app/(admin)/admin/data/
app/hygiene/                      → app/(admin)/admin/hygiene/
app/prd/                          → app/(admin)/admin/prd/
```

- [ ] **Step 1: Create destination directories and move files**

```bash
mkdir -p app/\(admin\)/admin/members app/\(admin\)/admin/at-risk app/\(admin\)/admin/hiatus
mkdir -p app/\(admin\)/admin/member-overrides app/\(admin\)/admin/reconciliation app/\(admin\)/admin/prickles
mkdir -p app/\(admin\)/admin/calendar app/\(admin\)/admin/data app/\(admin\)/admin/hygiene app/\(admin\)/admin/prd

mv app/dashboard/page.tsx app/\(admin\)/admin/page.tsx
mv app/dashboard/DashboardCharts.tsx app/\(admin\)/admin/DashboardCharts.tsx
mv app/dashboard/members/page.tsx app/\(admin\)/admin/members/page.tsx
mv app/dashboard/members/MemberFilters.tsx app/\(admin\)/admin/members/MemberFilters.tsx
mv app/dashboard/at-risk/page.tsx app/\(admin\)/admin/at-risk/page.tsx
mv app/dashboard/hiatus/page.tsx app/\(admin\)/admin/hiatus/page.tsx
mv app/dashboard/member-overrides/page.tsx app/\(admin\)/admin/member-overrides/page.tsx
mv app/dashboard/prickles/page.tsx app/\(admin\)/admin/prickles/page.tsx
mv app/dashboard/reconciliation/page.tsx app/\(admin\)/admin/reconciliation/page.tsx
mv app/calendar/page.tsx app/\(admin\)/admin/calendar/page.tsx
mv app/data/import app/\(admin\)/admin/data/import
mv app/data/aliases app/\(admin\)/admin/data/aliases
mv app/data/prickle-types app/\(admin\)/admin/data/prickle-types
mv app/hygiene/page.tsx app/\(admin\)/admin/hygiene/page.tsx
mv app/hygiene/ProcessOrphanedButton.tsx app/\(admin\)/admin/hygiene/ProcessOrphanedButton.tsx
mv app/hygiene/ProcessOrphanedMeetingsButton.tsx app/\(admin\)/admin/hygiene/ProcessOrphanedMeetingsButton.tsx
mv app/hygiene/unmatched-events app/\(admin\)/admin/hygiene/unmatched-events
mv app/hygiene/unmatched-zoom app/\(admin\)/admin/hygiene/unmatched-zoom
mv app/hygiene/name-matching app/\(admin\)/admin/hygiene/name-matching
mv app/prd/page.tsx app/\(admin\)/admin/prd/page.tsx
mv app/prd/MarkdownRenderer.tsx app/\(admin\)/admin/prd/MarkdownRenderer.tsx
```

- [ ] **Step 2: Fix the CalendarWeekView import in the moved calendar page**

In `app/(admin)/admin/calendar/page.tsx`, find the import line:
```ts
import CalendarWeekView from "./CalendarWeekView";
```
Replace with:
```ts
import CalendarWeekView from "@/components/CalendarWeekView";
```

- [ ] **Step 3: Delete old layout files and now-empty directories**

`app/dashboard/` still contains `profile/` (moved in Task 8), so don't remove it here.

```bash
rm app/dashboard/layout.tsx app/dashboard/Navigation.tsx
rm app/calendar/layout.tsx
rm app/data/layout.tsx
rm app/hygiene/layout.tsx
rmdir app/calendar app/data app/hygiene app/prd 2>/dev/null || true
```

- [ ] **Step 4: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors. Fix any import paths that break (should only be the CalendarWeekView one changed in Step 2).

- [ ] **Step 5: Run existing tests**

```bash
npx vitest run tests/
```

Expected: all pass. Dashboard member-filters test imports from component paths — verify it still resolves.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: move all admin pages into (admin)/admin/ route group"
```

---

## Task 7: Create Member Route Group — Layout + Navigation

**Files:**
- Create: `components/MemberNavigation.tsx`
- Create: `app/(member)/layout.tsx`

- [ ] **Step 1: Write `components/MemberNavigation.tsx`**

The nav has one item (My Calendar). The Admin Portal button is conditionally rendered from a prop passed by the server layout.

```tsx
"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface MemberNavigationProps {
  isAdmin: boolean;
}

export default function MemberNavigation({ isAdmin }: MemberNavigationProps) {
  const [collapsed, setCollapsed] = useState(true);
  const pathname = usePathname();

  useEffect(() => {
    const isMobile = window.innerWidth < 768;
    setCollapsed(isMobile);
    const handleResize = () => setCollapsed(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isActive = pathname === '/calendar';

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
      <nav className="p-4 flex-1">
        <Link
          href="/calendar"
          className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
            isActive
              ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium"
              : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          }`}
          title={collapsed ? "My Calendar" : undefined}
        >
          <span className="text-lg">📅</span>
          {!collapsed && <span>My Calendar</span>}
        </Link>
      </nav>

      {/* Admin Portal — fixed at bottom, admin-only */}
      {isAdmin && (
        <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex-shrink-0">
          <Link
            href="/admin"
            className="flex items-center gap-3 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            title={collapsed ? "Admin Portal" : undefined}
          >
            <span className="text-lg">⚙️</span>
            {!collapsed && <span className="text-sm">Admin Portal →</span>}
          </Link>
        </div>
      )}
    </aside>
  );
}
```

- [ ] **Step 2: Write `app/(member)/layout.tsx`**

```tsx
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import MemberNavigation from "@/components/MemberNavigation";
import UserMenu from "@/components/UserMenu";

export default async function MemberLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const isAdmin = profile?.role === "admin";

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950">
      <MemberNavigation isAdmin={isAdmin} />
      <div className="flex flex-col flex-1 min-w-0">
        <header className="h-16 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-end px-6 flex-shrink-0 relative z-30">
          <UserMenu userEmail={user.email || "User"} />
        </header>
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/\(member\)/layout.tsx components/MemberNavigation.tsx
git commit -m "feat: add member route group with layout and MemberNavigation"
```

---

## Task 8: Move Profile Pages to `(member)/profile/`

**Files:**
- Move: `app/dashboard/profile/` → `app/(member)/profile/`

These files use only `@/` absolute imports, so no import changes are needed.

- [ ] **Step 1: Move the profile directory**

```bash
mkdir -p app/\(member\)/profile
mv app/dashboard/profile/page.tsx app/\(member\)/profile/page.tsx
mv app/dashboard/profile/actions.ts app/\(member\)/profile/actions.ts
mv app/dashboard/profile/ThemeSwitcher.tsx app/\(member\)/profile/ThemeSwitcher.tsx
mv app/dashboard/profile/TimezoneSwitcher.tsx app/\(member\)/profile/TimezoneSwitcher.tsx
```

- [ ] **Step 2: Remove the inline auth redirect in `app/(member)/profile/page.tsx`**

The profile page currently has its own auth redirect (`if (!user) redirect("/login")`). This is now redundant — the `(member)` layout already handles that. Remove the check:

Open `app/(member)/profile/page.tsx`. Delete these lines:
```ts
if (!user) {
  redirect("/login");
}
```

Also remove the unused `redirect` import if it is no longer used.

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Remove now-empty `app/dashboard/`**

After profile is moved, `app/dashboard/` has no remaining files.

```bash
rmdir app/dashboard 2>/dev/null || true
```

- [ ] **Step 5: Commit**

```bash
git add app/\(member\)/profile/ app/dashboard/
git commit -m "refactor: move profile pages to (member)/profile/"
```

---

## Task 9: Update Root Page to Redirect by Role

**Files:**
- Modify: `app/page.tsx`

Currently redirects all authenticated users to `/dashboard`. Now redirect admins to `/admin` and members to `/calendar`.

- [ ] **Step 1: Update `app/page.tsx`**

```ts
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role === "admin") {
    redirect("/admin");
  }

  redirect("/calendar");
}
```

- [ ] **Step 2: Commit**

```bash
git add app/page.tsx
git commit -m "feat: update root redirect to route by role (admin→/admin, member→/calendar)"
```

---

## Task 10: Build the Member Calendar Page

The member calendar shows only prickles the logged-in user attended. It resolves the user's `members` record by email, then fetches their `prickle_attendance` for the selected week.

**Files:**
- Create: `app/(member)/calendar/page.tsx`

- [ ] **Step 1: Write `app/(member)/calendar/page.tsx`**

```tsx
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import CalendarWeekView from "@/components/CalendarWeekView";
import { getUserTimezonePreference } from "@/lib/timezone";

export default async function MemberCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // Layout guarantees user is authenticated; assertion satisfies TypeScript.
  if (!user) return null;

  const params = await searchParams;

  // Parse week from URL param or default to last week
  let weekStart: Date;
  if (params.week) {
    const [year, month, day] = params.week.split('-').map(Number);
    const paramDate = new Date(year, month - 1, day);
    const dayOfWeek = paramDate.getDay();
    weekStart = new Date(paramDate);
    weekStart.setDate(paramDate.getDate() - dayOfWeek);
    weekStart.setHours(0, 0, 0, 0);
  } else {
    const now = new Date();
    const dayOfWeek = now.getDay();
    weekStart = new Date(now);
    weekStart.setDate(now.getDate() - dayOfWeek - 7);
    weekStart.setHours(0, 0, 0, 0);
  }

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);
  weekEnd.setHours(0, 0, 0, 0);

  const prevWeek = new Date(weekStart);
  prevWeek.setDate(weekStart.getDate() - 7);
  const nextWeek = new Date(weekStart);
  nextWeek.setDate(weekStart.getDate() + 7);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isNextDisabled = nextWeek.getTime() > today.getTime();
  const formatWeekParam = (date: Date) => date.toISOString().split("T")[0];

  // Resolve the member record for this user by email
  const { data: member } = await supabase
    .from("members")
    .select("id, name")
    .eq("email", user.email!)
    .single();

  if (!member) {
    return (
      <div className="container mx-auto px-6 py-8">
        <div className="bg-white dark:bg-slate-900 rounded-lg p-8 text-center border border-slate-200 dark:border-slate-800">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">
            Account not linked
          </h2>
          <p className="text-slate-600 dark:text-slate-400">
            Your account isn&apos;t linked to a member profile yet. Contact an admin.
          </p>
        </div>
      </div>
    );
  }

  // Fetch all prickles for the week
  const { data: prickles, error: pricklesError } = await supabase
    .from("prickles")
    .select("id, start_time, end_time, type_id, prickle_types:type_id(name)")
    .gte("start_time", weekStart.toISOString())
    .lt("start_time", weekEnd.toISOString())
    .order("start_time", { ascending: true });

  if (pricklesError) throw pricklesError;

  // Fetch prickles this member attended during the week
  const { data: attended } = await supabase
    .from("prickle_attendance")
    .select("prickle_id")
    .eq("member_id", member.id)
    .gte("join_time", weekStart.toISOString())
    .lt("join_time", weekEnd.toISOString());

  const attendedIds = new Set(attended?.map((a) => a.prickle_id) ?? []);

  // Shape data to match CalendarWeekView props.
  // attendance_count: 1 = attended, 0 = did not attend.
  const pricklesForView = (prickles ?? []).map((p: any) => ({
    id: p.id,
    start_time: p.start_time,
    end_time: p.end_time,
    prickle_type: p.prickle_types?.name ?? "Unknown",
    attendance_count: attendedIds.has(p.id) ? 1 : 0,
    host: null,
    host_id: null,
    host_missing: false,
    host_late: false,
  }));

  const userTimezone = await getUserTimezonePreference();

  return (
    <div className="container mx-auto px-6 py-8">
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">My Attendance</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              Week of {weekStart.toLocaleDateString()} — highlighted prickles are ones you attended
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/calendar?week=${formatWeekParam(prevWeek)}`}
              className="px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-slate-700 dark:text-slate-300 transition-colors"
            >
              ← Previous
            </Link>
            {isNextDisabled ? (
              <span className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-600 cursor-not-allowed">
                Next →
              </span>
            ) : (
              <Link
                href={`/calendar?week=${formatWeekParam(nextWeek)}`}
                className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors"
              >
                Next →
              </Link>
            )}
          </div>
        </div>
      </div>
      <CalendarWeekView
        prickles={pricklesForView}
        weekStartDate={{
          year: weekStart.getFullYear(),
          month: weekStart.getMonth(),
          day: weekStart.getDate(),
        }}
        userTimezonePreference={userTimezone}
      />
    </div>
  );
}
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/\(member\)/calendar/page.tsx
git commit -m "feat: add member attendance calendar page at /calendar"
```

---

## Task 11: Add `requireAdmin()` to All Admin API Handlers

All handlers under `app/api/` except `app/api/webhooks/*` need to require admin role. The current handlers have three different auth patterns:

**Pattern A** — bare `createClient()` (no `request` param, no service-role support):
```ts
const supabase = await createClient();
const { data: { user } } = await supabase.auth.getUser();
if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
```

**Pattern B** — inline dual-auth (service-role + cookie, duplicates what `createApiAuth` does):
```ts
const authHeader = request.headers.get('authorization');
// ... 15 lines of inline logic ...
```

**Pattern C** — already uses `createApiAuth(request)`:
```ts
const { supabase, user } = await createApiAuth(request);
if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
```

All three patterns get replaced with the same four lines using `requireAdmin`:

```ts
import { requireAdmin } from "@/lib/supabase/api-auth";

// Inside the handler function:
const auth = await requireAdmin(request);
if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
const { supabase } = auth;
```

**Files to update** (all except `app/api/webhooks/*`):

```
app/api/admin/apply-aliases/route.ts
app/api/aliases/route.ts
app/api/aliases/slack/route.ts
app/api/analyze/kajabi-stripe-comparison/route.ts
app/api/analyze/subscription-reconciliation/route.ts
app/api/data-hygiene/slack-users/skip/route.ts
app/api/import/calendar/route.ts
app/api/import/members/route.ts
app/api/import/slack-api/route.ts
app/api/import/slack/route.ts
app/api/import/subscriptions/route.ts
app/api/import/zoom/route.ts
app/api/member-overrides/route.ts
app/api/member-overrides/[id]/route.ts
app/api/members/route.ts
app/api/members/network/route.ts
app/api/prickle-types/create/route.ts
app/api/prickle-types/ignore-batch/route.ts
app/api/prickle-types/ignore/route.ts
app/api/prickle-types/resolve-batch/route.ts
app/api/prickle-types/resolve/route.ts
app/api/prickle-types/update/route.ts
app/api/process/attendance/route.ts
app/api/process/calendar/route.ts
app/api/process/hiatus/route.ts
app/api/process/members/route.ts
app/api/process/slack/route.ts
app/api/reconcile/calendar/route.ts
app/api/reconcile/members/route.ts
app/api/reconcile/zoom/route.ts
app/api/reports/name-matching/route.ts
app/api/reports/unmatched-slack-users/route.ts
app/api/sync/calendar/route.ts
app/api/sync/kajabi/route.ts
app/api/sync/stripe/route.ts
app/api/zoom/ignore/route.ts
app/api/zoom/prickles/route.ts
```

- [ ] **Step 1: Update `app/api/import/members/route.ts` (Pattern A example)**

Remove the existing auth block and replace with requireAdmin. The existing block is:
```ts
import { createClient } from "@/lib/supabase/server";
// ...
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // rest of handler uses `supabase`
```

Replace with:
```ts
import { requireAdmin } from "@/lib/supabase/api-auth";
// (remove the createClient import if it's only used for auth)
// ...
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;
  // rest of handler unchanged
```

- [ ] **Step 2: Update `app/api/process/attendance/route.ts` (Pattern B example)**

Remove the 15-line inline auth block starting at `const authHeader = request.headers.get('authorization')` through `}` (the closing brace of the `else` block that sets `supabase` and checks `!user`). Replace with:

```ts
import { requireAdmin } from "@/lib/supabase/api-auth";
// ...
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;
  // rest of handler unchanged (remove the old `let supabase;` declaration too)
```

- [ ] **Step 3: Apply the same change to all remaining files in the list**

For each file: find the auth block (whichever pattern it uses), replace with the four-line requireAdmin block. The `supabase` variable the rest of the handler uses must come from `auth.supabase`.

- [ ] **Step 4: Run all API tests**

```bash
npx vitest run tests/api/
```

Expected: all pass. The service-role bypass in `requireAdmin` means integration tests continue working.

- [ ] **Step 5: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/api/
git commit -m "feat: require admin role on all non-webhook API handlers"
```

---

## Task 12: Verify Build and Clean Up

- [ ] **Step 1: Full TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 2: Run full test suite**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 3: Build check**

```bash
npm run build
```

Expected: successful build with no route conflicts. Confirm these routes exist in the output:
- `/ (SSG)`
- `/login`
- `/calendar`
- `/profile`
- `/admin`
- `/admin/members`
- `/admin/calendar`
- `/admin/data/import`
- `/admin/hygiene`

- [ ] **Step 4: Clean up any leftover empty directories**

```bash
find app/dashboard app/calendar app/data app/hygiene app/prd -type d -empty -delete 2>/dev/null || true
```

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: verify build and remove leftover empty directories"
```
