# Admin / Member Separation Design

**Date:** 2026-05-14  
**Status:** Approved

## Overview

Separate the application into two distinct sections: an admin section (all existing functionality) under `/admin/*` and a member-facing section (personal attendance calendar) at `/*`. Enforce role-based access at the layout and API handler levels. The app is not yet live, so old URLs do not require redirect compatibility.

---

## URL Structure

### Member routes (any authenticated user)

| URL | Page |
|-----|------|
| `/` | Redirects to `/calendar` (members) or `/admin` (admins) based on role |
| `/calendar` | Personal attendance calendar — prickles the logged-in member attended |
| `/profile` | Profile settings (theme, timezone) — also accessible from user dropdown |
| `/login` | Login page (unauthenticated) |

### Admin routes (role = `admin` required)

| URL | Source |
|-----|--------|
| `/admin` | Moved from `/dashboard` |
| `/admin/members` | Moved from `/dashboard/members` |
| `/admin/at-risk` | Moved from `/dashboard/at-risk` |
| `/admin/hiatus` | Moved from `/dashboard/hiatus` |
| `/admin/member-overrides` | Moved from `/dashboard/member-overrides` |
| `/admin/reconciliation` | Moved from `/dashboard/reconciliation` |
| `/admin/prickles` | Moved from `/dashboard/prickles` |
| `/admin/calendar` | Moved from `/calendar` |
| `/admin/data/import` | Moved from `/data/import` |
| `/admin/data/aliases` | Moved from `/data/aliases` |
| `/admin/data/prickle-types` | Moved from `/data/prickle-types` |
| `/admin/hygiene` | Moved from `/hygiene` |
| `/admin/hygiene/unmatched-events` | Moved from `/hygiene/unmatched-events` |
| `/admin/hygiene/unmatched-zoom` | Moved from `/hygiene/unmatched-zoom` |
| `/admin/hygiene/name-matching` | Moved from `/hygiene/name-matching` |

### API routes (unchanged URLs)

API route URLs do not change. Access control is enforced inside each handler, not by URL prefix. Admin-only handlers call `requireAdmin()` (see Security section). Webhook routes (`/api/webhooks/*`) are external-facing and untouched.

---

## File Structure

Next.js route groups provide layout separation without affecting URLs.

```
app/
  (member)/
    layout.tsx          ← member nav, auth check (redirect to /login if no session)
    calendar/
      page.tsx          ← NEW: personal attendance calendar
      CalendarWeekView.tsx (reused from admin calendar)
    profile/
      page.tsx          ← moved from app/dashboard/profile/
      actions.ts
      ThemeSwitcher.tsx
      TimezoneSwitcher.tsx
  (admin)/
    layout.tsx          ← admin nav, role check (403 if role ≠ admin)
    admin/
      page.tsx          ← moved from app/dashboard/page.tsx
      DashboardCharts.tsx
      Navigation.tsx    ← replaced by new AdminNavigation
      members/          ← moved from app/dashboard/members/
      at-risk/          ← moved from app/dashboard/at-risk/
      hiatus/           ← moved from app/dashboard/hiatus/
      member-overrides/ ← moved from app/dashboard/member-overrides/
      reconciliation/   ← moved from app/dashboard/reconciliation/
      prickles/         ← moved from app/dashboard/prickles/
      calendar/         ← moved from app/calendar/
      data/
        import/         ← moved from app/data/import/
        aliases/        ← moved from app/data/aliases/
        prickle-types/  ← moved from app/data/prickle-types/
      hygiene/          ← moved from app/hygiene/
  page.tsx              ← root redirect by role
  login/page.tsx        ← unchanged
  auth/                 ← unchanged
  api/                  ← unchanged URLs, role checks added to admin handlers
components/
  UserMenu.tsx          ← moved from app/dashboard/ (shared by both layouts)
  SignOutButton.tsx      ← moved from app/dashboard/ (shared by both layouts)
```

---

## Navigation

### Member navigation (`app/(member)/layout.tsx`)

- Fixed sidebar, does not scroll with content
- Items: **My Calendar** only (more items added as member features are built)
- Bottom of sidebar (fixed): **⚙️ Admin Portal →** button — visible only when `user_profiles.role = 'admin'`, links to `/admin`
- Top-right header: existing `UserMenu` dropdown (contains Profile link, Sign Out)

### Admin navigation (`app/(admin)/layout.tsx`)

- Fixed sidebar, does not scroll with content  
- Top of sidebar: **← My View** link, returns to `/calendar`
- Sections and items: identical to current `Navigation.tsx`, all hrefs updated to `/admin/*`
- Top-right header: same `UserMenu` dropdown

---

## Security

### Middleware (`middleware.ts`)

Updated to protect all non-public routes (not just `/dashboard`):

```
Protected: all routes except /login, /auth/*, /api/webhooks/*, static assets
Unauthenticated → redirect to /login
```

### Layout role check (`app/(admin)/layout.tsx`)

Server component. After confirming session exists, reads `user_profiles.role`. If not `admin`, returns a 403 page (not a redirect — admins-in-training shouldn't be silently bounced to the member view).

### API handler role check

`createApiAuth` gains a `requireAdmin` helper:

```ts
export async function requireAdmin(request: NextRequest) {
  const auth = await createApiAuth(request)
  if (!auth.user) return { ...auth, forbidden: true }
  // Service-role bypass used by integration tests — always permitted
  if (auth.user.id === 'service-role') return { ...auth, forbidden: false }
  const { data: profile } = await auth.supabase
    .from('user_profiles').select('role').eq('id', auth.user.id).single()
  if (profile?.role !== 'admin') return { ...auth, forbidden: true }
  return { ...auth, forbidden: false }
}
```

All admin-only API handlers call `requireAdmin` and return `{ status: 403 }` if `forbidden`.

---

## Member Calendar (`/calendar`)

New page. Resolves the logged-in user's `members` record by matching `user.email = members.email`. Displays a weekly attendance view showing only prickles that member attended, using the same week-navigation UI as the admin calendar.

**If no matching `members` record:** renders an informational message ("Your account isn't linked to a member profile yet — contact an admin.") rather than an error.

Data query: `prickle_attendance` joined to `prickles` filtered by `member_id` of the resolved member.

---

## Role Defaults

The `create_user_profile` trigger default changes from `'admin'` to `'member'`. New signups are unprivileged until explicitly granted admin role.

New migration:
```sql
ALTER FUNCTION create_user_profile() ... -- update DEFAULT to 'member'
```

**TODO:** Auto-provision member accounts via Kajabi webhooks when a new member signs up, so their `members` record and `user_profiles` row are created/linked automatically without manual admin action.

---

## Out of Scope

- RLS row-level policies scoped by role (Phase 2, tracked separately)
- Member features beyond calendar and profile
- `assistant` role (schema supports it; no UI planned yet)
