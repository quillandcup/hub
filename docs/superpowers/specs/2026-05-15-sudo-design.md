# Sudo (View As Member) Feature Design

**Date:** 2026-05-15
**Status:** Approved

## Overview

Admins need to view the member portal as a specific member to debug their experience. This feature adds a "Sudo As" capability that lets admins impersonate any member in the member portal while remaining authenticated as themselves.

Sudo only applies to member-facing data views (calendar). The profile/preferences page always shows the real admin's own preferences — sudo has no effect there.

## Security Model

The sudo cookie cannot grant access that the underlying auth session doesn't already have. The security chain is:

1. **UI gate** — "Sudo As" only visible to admins
2. **Server action gate** — `startSudo`/`exitSudo` verify admin role via DB check before doing anything
3. **Per-request gate** — `getEffectiveIdentity` verifies admin role on every page render before honoring the cookie; non-admins always get their own identity
4. **Tamper protection** — cookie value is HMAC-SHA256 signed with `SUDO_SECRET` env var; any tampering invalidates it
5. **Cookie flags** — `HttpOnly`, `Secure`, `SameSite=Strict` prevent JS access and CSRF

A regular member who manually sets the `sudo_as` cookie gets it silently ignored at step 3.

### Cookie Structure

Two cookies are set on sudo entry:

- **`sudo_as`**: `${adminId}:${memberId}:${hmacSignature}` — binds the cookie to the specific admin who created it
- **`sudo_return_to`**: the originating URL to return to on exit (plain HttpOnly cookie)

Both are session-scoped (no explicit expiry).

## Data Flow

All member pages follow this chain:

```
supabase.auth.getUser()
  → getEffectiveIdentity(realUser)
  → { memberId, memberName, isSudo }
  → use memberId for all DB queries
```

`getEffectiveIdentity` is the single source of truth for member identity in the member portal. It:
1. Reads the `sudo_as` cookie
2. Verifies HMAC signature
3. Verifies `realUser` is an admin in `user_profiles`
4. Returns the sudo target's `{ memberId, memberName, isSudo: true }`, or the real user's member record with `isSudo: false`

Member UUIDs (from the `members` table) are used for all DB queries — no email-based member lookups in individual pages.

If the real user has no `members` record (e.g., an admin-only account with no member profile) and no sudo is active, `getEffectiveIdentity` returns `null`. The member layout redirects such users to `/admin` rather than showing an error page.

## UI/UX

### Entering Sudo

"Sudo As" appears in the `UserMenu` dropdown when `isAdmin={true}`. Clicking it opens `SudoModal`, which:
- Loads all members upfront (server component parent)
- Renders `MemberSearch` for client-side name/email filtering
- On confirm, calls `startSudo(memberId)` server action → redirects to `/calendar`

"Sudo As" is hidden during an active sudo session (no nested sudo).

### Active Sudo

A persistent `SudoBanner` renders above the header in the `(member)` layout when `isSudo` is true:

```
🔴  Viewing as Jane Smith (jane@example.com)  |  [Exit Sudo]
```

The admin nav is absent — you are fully in the member portal view. The `UserMenu` receives the effective identity (sudo'd member's name/email) from the layout's `EffectiveIdentityContext`, so the header feels authentic.

### Exiting Sudo

"Exit Sudo" in the banner calls `exitSudo()` server action, which clears both cookies and redirects to the stored `sudo_return_to` URL (fallback: `/admin`).

## Server Actions

**`startSudo(memberId: string)`** (`app/actions/sudo.ts`)
1. Verify caller is an authenticated admin (DB check)
2. Look up target member by `memberId` — error if not found
3. Sign `adminId:memberId` with HMAC-SHA256
4. Set `sudo_as` cookie (HttpOnly, Secure, SameSite=Strict)
5. Set `sudo_return_to` cookie with current URL
6. Redirect to `/calendar`

**`exitSudo()`** (`app/actions/sudo.ts`)
1. Verify caller is an authenticated admin
2. Read `sudo_return_to` cookie
3. Clear both cookies
4. Redirect to stored return URL (fallback: `/admin`)

## Files

### New
| File | Purpose |
|------|---------|
| `lib/sudo.ts` | `getEffectiveIdentity(realUser)` + HMAC sign/verify |
| `app/actions/sudo.ts` | `startSudo` and `exitSudo` server actions |
| `components/SudoBanner.tsx` | Red persistent bar with member name and Exit Sudo button |
| `components/SudoModal.tsx` | Modal wrapping `MemberSearch` with confirm button |

### Modified
| File | Change |
|------|--------|
| `components/UserMenu.tsx` | Add `isAdmin` prop; render "Sudo As" item (hidden during active sudo) |
| `app/(member)/layout.tsx` | Call `getEffectiveIdentity`; render `SudoBanner` when `isSudo`; wrap children in a client `EffectiveIdentityContext` provider so pages can read `memberId` without prop drilling |
| `app/(member)/calendar/page.tsx` | Use `effectiveIdentity.memberId` instead of email-based member lookup |
| `app/(admin)/layout.tsx` | Pass `isAdmin={true}` to `UserMenu` |

### Unchanged
| File | Reason |
|------|--------|
| `app/(member)/profile/page.tsx` | Always uses real user; sudo explicitly excluded |
| `middleware.ts` | Cookie security handled in server actions |

## Out of Scope

- Profile/preferences page impersonation (preferences are personal to the logged-in admin)
- Nested sudo (sudo while already sudo'd)
- Sudo audit logging (can be added later)
- Sudo session expiry (session-scoped cookie is sufficient for now)
