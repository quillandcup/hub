---
paths:
  - "app/(admin)/**"
  - "app/api/admin/**"
  - "lib/admin-auth.ts"
  - "lib/admin-paths.ts"
  - "lib/staff-access.ts"
  - "lib/staff-preview.ts"
  - "lib/staff-mfa.ts"
  - "lib/staff-mfa.server.ts"
  - "lib/supabase/middleware.ts"
  - "lib/supabase/api-auth.ts"
  - "proxy.ts"
  - "tests/components/pages/admin-auth.test.tsx"
---

### Admin Route Protection

**RULE**: Every `app/(admin)/admin/**/page.tsx` starts with `await requireAdminPage()`, and every admin-only server action starts with `const auth = await requireAdminAction(); if (!auth.ok) return { error: auth.error };` (both from `lib/admin-auth.ts`). Don't hand-roll `user_profiles` role checks, and don't rely on the admin layout or the page to protect an action.

Layers, per the Next.js auth guide (`node_modules/next/dist/docs/01-app/02-guides/authentication.md`):
- **Optimistic, in `proxy.ts`** (`lib/supabase/middleware.ts`): `/admin` and `/admin/*` (not `/administrivia`; see `isAdminPath` in `lib/admin-paths.ts`) → anonymous to `/login`, signed-in non-admin to `/no-access`. Reuses the user the proxy already loads, and reads the role from the `app_role` claim of the access token its `getUser()` just verified. The proxy never reads `user_profiles`. The claim is added by the Supabase custom access token hook (`public.custom_access_token_hook`, migration `20260926000900`, enabled by `[auth.hook.custom_access_token]` in `supabase/config.toml`): the role string, or JSON `null` when there's no `user_profiles` row. Anything but `"admin"`, including a missing claim (hook not enabled, or its lookup failed), counts as not-admin and goes to `/no-access`.
- **Secure, next to the data**: `requireAdminPage()` in `app/(admin)/layout.tsx` and every admin page (memoized with `cache()`, so layout + page share one lookup), same redirects. Pages repeat it because layouts don't re-run on client navigation and don't stop a page segment from rendering. It reads `user_profiles.role` on purpose, and so does `requireAdminAction()`: **never authorize from the `app_role` claim.** A token keeps the role it was minted with until it refreshes, up to `auth.jwt_expiry` (3600s, i.e. up to 1 hour). A demoted admin keeps an `admin` claim for up to that long, so the proxy lets them past the pre-filter and the page-level check stops them. A newly promoted admin gets sent to `/no-access` by the proxy until their token refreshes (up to 1 hour, or at once if they sign out and back in).
- **Server actions** are directly callable POST endpoints, so each admin action checks for itself with `requireAdminAction()` (returns `{ ok: false, error }` rather than redirecting; `startSudo` throws it). `tests/components/pages/admin-auth.test.tsx` fails if an admin page or an action in a `"use server"` file under `app/(admin)/` (or `app/actions/sudo.ts`) is missing its check; list deliberate exceptions there with a reason.

**Community manager (`user_profiles.role = 'community_manager'`)**: a member who is a semi-volunteer (paid in comps, no contract) and opens a fixed set of admin pages read-only. The set is `lib/staff-access.ts` (`isCommunityManagerPath`): anything not listed there is admin-only, so a new admin page is closed to them until someone adds it on purpose. A page they may open starts with `await requireStaffPage()` (returns the user and their `role`) instead of `requireAdminPage()`; `tests/components/pages/admin-auth.test.tsx` fails if the page check and the allowlist disagree, and `tests/lib/staff-access.test.ts` keeps the sidebar flag (`communityManager` in `lib/site-pages.ts`) equal to the allowlist. The proxy lets them past `/admin` only on those paths. Their server actions stay on `requireAdminAction()` (it refuses them), and every control or view inside those pages is an opt-in staff feature (`STAFF_FEATURES` in `lib/staff-access.ts`; `COMMUNITY_MANAGER_FEATURES` starts empty, `can()`/`staffCan()` gate each one), so a new button is hidden from them until granted. `COMMUNITY_MANAGER_FEATURES` today holds `care.write` and `member.activity_tab_limited`: the member page's Activity tab with only the member's own activity (`member_activities` rows: no audit entries, page visits or staff notes, no central log link), enforced in the database too (`get_activity_feed` and `count_activity_feed` serve a community manager only with a member and only the `activity` kind, `20270817000000`; `docs/ACTIVITY_AND_AUDIT_LOG.md`, "The community manager's Activity tab"). Opt-in is the rule for every new role: pages, features and DB tables each start at none. Data is guarded by RLS, not by the page: policies use `is_community_manager()`; never widen `is_admin()` for them.

**Preview as a role**: an admin can look at the admin area as a community manager (user menu → "Preview as Community Manager", exit from the banner). A `staff_preview_role` cookie (`lib/staff-preview.ts`) lowers the *effective* role for a real admin only (anyone else's cookie is ignored): the proxy, `requireStaffPage()` (returns `role` and `realRole`) and `requireAdminPage()`/`requireAdminAction()` then treat them as that role, so admin-only pages send them to the role's home and actions are refused. It is UI and routing only: data is still read with the admin's RLS access, so test a database limit with a real account of that role. Not sudo (sudo changes the member acted as, never the staff role). A new previewable role is an entry in `PREVIEWABLE_ROLES`.

**Non-admins go to `/no-access`, never a member page**: member pages send anyone without a member record to `/admin`, so redirecting non-admins back to `/dashboard` would loop. `app/no-access/page.tsx` sits outside both route groups and must never redirect a signed-in user.

**Second sign-in step (TOTP, `docs/STAFF_MFA.md`, `lib/staff-mfa.ts`)**: all four guards (the proxy, `requireAdminPage`/`requireStaffPage`, `requireAdminAction`/`requireStaffAction`, and `requireAdmin` for API routes) hold staff to aal2 when their account has a verified factor, and, from `staffMfaRequiredFrom` in `app.config.ts` (unset = off), to having one. Pages redirect through the `staffMfa` gate to `/mfa` and back; actions return `MFA_REQUIRED_ERROR`; `/mfa` sits outside both route groups like `/no-access`. The proxy reads the token's `aal` claim and `user.factors` from the `getUser()` it already ran; the page and action guards use `lib/staff-mfa.server.ts`. A new admin guard or entry point needs the same check.

Sudo doesn't affect any of these checks: the sudo cookie changes the effective *member*, not the signed-in admin. API routes use `requireAdmin` (`lib/supabase/api-auth.ts`) instead.

The hook is tested by `supabase/tests/database/custom_access_token_hook.test.sql` (pgTAP, rolled back; `pnpm test:pgtap`, which CI also runs). Because the proxy has no fallback, **no one reaches `/admin` on a project until the hook is enabled there** (and they've signed in again or their token has refreshed). See "Supabase config as code" below for how it gets enabled.
