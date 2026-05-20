# Clickable Calendar Prickles for Members

**Date:** 2026-05-19  
**Status:** Approved

## Overview

Make prickle blocks in the "My Attendance" member calendar clickable, linking to a shared prickle detail page. Move the existing admin-only prickle detail page to a shared route accessible to all authenticated users, with role-aware member links and back navigation.

## Goals

- Members can click prickles in their attendance calendar to view full details
- Prickle detail page shows the same information as the current admin view (type, host, date/time, attendee list, timezone selector)
- Hover tooltip works in member mode (same as admin mode)
- Member links in the detail page go to `/members/{id}`, not `/admin/members/{id}`
- No duplicate data-fetching logic — one page handles both roles

## Routes

| Before | After |
|--------|-------|
| `/admin/prickles/{id}` (admin only) | `/prickles/{id}` (all authenticated users) |

The `/admin/prickles` list page is unchanged.

## Files Changed

### Move & update: prickle detail page

`app/(admin)/admin/prickles/[id]/page.tsx` → `app/(member)/prickles/[id]/page.tsx`

- Detect user role: query `user_profiles.role` for the current user (`role === 'admin'`)
- Pass `memberBasePath` to `PrickleDetails`: `/admin/members` for admins, `/members` for non-admins
- Back link: `/admin/calendar` for admins, `/calendar` for non-admins
- "Prickle not found" back link: same dynamic logic

### Move & update: PrickleDetails component

`app/(admin)/admin/prickles/[id]/PrickleDetails.tsx` → `app/(member)/prickles/[id]/PrickleDetails.tsx`

- Add `memberBasePath: string` prop (no default — caller always provides it)
- Replace two hard-coded `/admin/members/${id}` links with `${memberBasePath}/${id}`

### Update: CalendarWeekView

`components/CalendarWeekView.tsx`

- Enable click in member mode: navigate to `/prickles/${prickle.id}` (both modes now link to `/prickles/`)
- Enable hover tooltip in member mode (same tooltip already shown in admin mode)
- Remove the `mode !== "member"` guard from `onClick`, `onMouseEnter`, and tooltip render
- Update admin `onClick` route from `/admin/prickles/${id}` to `/prickles/${id}`

### Fix existing links (admin context, `/admin/prickles/{id}` → `/prickles/{id}`)

| File | Change |
|------|--------|
| `app/(admin)/admin/hygiene/unmatched-zoom/AliasSearchForm.tsx:307` | Link href |
| `app/(admin)/admin/members/[id]/AttendanceCalendar.tsx:195` | `router.push` |
| `app/(admin)/admin/members/[id]/MemberDetails.tsx:655` | `router.push` |

### Delete

`app/(admin)/admin/prickles/[id]/` (entire directory — page and component moved above)

## Data & Auth

No new queries. The moved page uses the same Supabase fetches as the current admin page. Auth already redirects to `/login` on unauthenticated access. RLS policies on `prickles` and `prickle_attendance` tables enforce data access — no additional server-side role check needed for the page content itself (all members can view any prickle).

## Non-Goals

- No changes to the `/admin/prickles` list page
- No redirect from old URL (fully moved, old URL 404s)
- No member-only restrictions on prickle content
