# Permissions: what staff roles may do

> **Status:** living. **Last reviewed:** 2026-11-21. Review: yearly. Kept up to date with the code; if it is wrong, fix it.

Access to the staff area is decided by **permissions**, not by "admin or not". A permission is an operation defined in code, a role is a named bundle of permissions, and every check goes through one function. This is the model for the Hub today and the shape meant to be reused in other apps.

- **Permissions are code.** `PERMISSIONS` in `src/lib/permissions.ts`, each named `<area>.<action>` (or `<area>.<thing>.<action>`) with a one-line description: `pages.edit`, `members.read`, `analytics.cohorts.read`. They are not rows in a table, so a permission can't exist without a guard in the code that uses it, and a code review sees every change to who may do what.
- **Roles are bundles.** `ROLE_PERMISSIONS` maps each staff role to its list. The roles are `user_profiles.role` values: `admin` (everything), `assistant` (the admin's list, derived from it so the two stay in step; see "The assistant" below), `community_manager` and `conversion_specialist`. Anyone else (`member`, no profile) holds nothing. Opt-in is the rule: a new permission is in no bundle but the admin's until someone adds it to another on purpose.
- **One check.** `can(actor, permission)` (`src/lib/permissions.ts`; the actor is anything with a `role`) is the only question anyone asks. The guards call it:
  - pages: `await requirePermission("pages.read")` (`src/lib/admin-auth.ts`; redirects);
  - server actions: `const auth = await requireActionPermission("pages.edit"); if (!auth.ok) return { error: auth.error };`;
  - route handlers: `const auth = await requireApiPermission(request, "pages.edit")` (`src/lib/supabase/api-auth.ts`; `user` null is 401, `forbidden` is 403; the cron secret and the test service-role key still bypass it);
  - the proxy and the sidebar: `mayOpenAdminPath(role, path)` (`src/lib/admin-paths.ts`), from the table of which permission each admin page needs. The proxy reads the role from the token claim and is only the pre-filter; the guards read `user_profiles.role` (see `.claude/rules/admin-route-protection.md`).
- **The database is the other half.** A permission decides what the application offers and runs. What a signed-in user's own client may read or write is still decided by row-level security: a role that can see a page also needs policies on the tables it reads (`is_community_manager()` and `is_conversion_specialist()` next to `is_admin()`; nothing ever widens `is_admin()`). Where the application reads with the service role after its own check, the permission is the only gate, so it is named for exactly that read (`care.member_activity.read`).

## The roles today

The page **Roles** (`/admin/roles`, permission `roles.read`: admin and assistant) lists every permission and every role with what it holds, marks the reserved permissions and the assistant's withheld one, and filters by permission text or role. It is read-only and generated from the registry (`buildPermissionMatrix` in `src/lib/permission-matrix.ts`), so it can't go stale; the one-line role descriptions come from `ROLE_DESCRIPTIONS` and the reason for a withheld permission from `ASSISTANT_WITHHELD_REASONS`, both in `src/lib/permissions.ts`. A new role needs a description there as well.

| Role | Holds |
|---|---|
| `admin` | every permission |
| `assistant` | the admin's, except `care.member_activity.read` (see below) |
| `community_manager` | the Calendar View, the member list and a member's page (with only their own activity in the Activity tab), At-Risk, a prickle's page, Hedgie Care (read and write), Community Stats, Slack Engagement, Resubscriptions |
| `conversion_specialist` | landing pages (read, edit, publish, not delete), outreach, browsing the media library, email, scheduled email and announcements (no surface yet), conversion and retention cohorts in aggregate (no surface yet) |

The conversion specialist has none of the members area (list, member pages, notes, contact data, merges, overrides, sudo), nothing of the changelog and no export. The full table of every role and permission is `tests/lib/permissions.test.ts`; it is written out permission by permission, and a new permission does not typecheck until the table decides it.

**The assistant.** The assistant mirrors the admin: its list is the admin's with only the permissions in `ASSISTANT_WITHHELD` taken out. Today that is `care.member_activity.read`, because the privacy page promises that the text of a member's tracked DMs and their activity in Hedgie Care are seen by admins and community managers, never an assistant. Row-level security still treats only `role = 'admin'` as `is_admin()`, so an assistant passes the application's guards but reads what its own client is allowed to: nothing of the admin tables, until `is_admin()` is extended on purpose (`docs/TODO.md`, "Back the assistant role in the database").

**Preview as a role.** A real admin can look at the staff area as another staff role: user menu, "Preview as...", which opens a dialog with a role dropdown and a "Start preview" button (`src/components/PreviewAsModal.tsx`). The dropdown lists `PREVIEWABLE_ROLES`, which is every staff role below the admin, taken from `STAFF_ROLES` with its label from `ROLE_LABELS`, so a new role appears without a UI change. The banner names the role and "Exit preview" leaves; starting lands on the role's `staffHome`. The effective role is the previewed one for the page guards, the action guards and the sidebar, so what the role may not open or do is refused. It is UI and routing only: data is still read with the admin's access. A new role needs a label in `ROLE_LABELS` and, if it doesn't start on the dashboard, a `staffHome`; nothing else.

## Why there are three guards

`requirePermission`, `requireActionPermission` and `requireApiPermission` ask the same question and differ only in how they fail, because a page, a server action and a route handler each have to fail in their own way: a page redirects (to `/login`, `/no-access`, the role's home or the second sign-in step), an action returns `{ ok: false, error }` so it keeps its result shape, and a route answers HTTP 401 or 403. The question itself, who the person is, what role they hold (an admin previewing is that role, never for routes), whether they hold the permission and whether the second sign-in step blocks them, is one function, `decideStaff` in `src/lib/staff-guard.ts`; each guard only finds the person (a cookie session, or for routes the cron secret and test key as well) and turns the answer into its failure. A fourth entry point should add a failure adapter, not a copy of the decision.

## Adding a permission

1. Add it to `PERMISSIONS` with a description. Name it for the operation, not for a page.
2. Use it: `requirePermission` on the page (and the path in `ADMIN_PAGE_PERMISSIONS` in `src/lib/admin-paths.ts`, which the proxy and the sidebar read), `requireActionPermission` in each action, `requireApiPermission` in each route, and `can(...)` for a control inside a page. If nothing uses it yet, list it in `RESERVED_PERMISSIONS` and say "no surface yet" in its description; the guard test fails on a stale reserved entry.
3. Decide each role: add it to the bundles that should hold it (`ROLE_PERMISSIONS`) and write the decision in the table in `tests/lib/permissions.test.ts`. The admin has it automatically.
4. If the role's own client reads or writes tables for it, add the row-level security policies in a migration (`is_<role>()` beside `is_admin()`, SELECT only unless the role writes) and a pgTAP test for what it can and can't read. Never widen `is_admin()`.

`tests/lib/permission-guards.test.ts` scans the source: every admin page, server action and staff route calls a guard with a permission that exists; a page's guard is the one the path table says; every permission is used by a guard or a check, or is reserved.

## Adding a role

A value in the `user_profiles.role` check constraint (an expand-only migration, with `is_<role>()` and its policies), an entry in `STAFF_ROLES` and `ROLE_PERMISSIONS`, a `staffHome` if it doesn't start on the dashboard, a description in `ROLE_DESCRIPTIONS` (the Roles page), a label in the Users page and (if it should be previewable) in `PREVIEWABLE_ROLES`. Audit and the staff definition (`audit_row_change()`, `staff_member_ids()`) count the role as staff in the same migration.

## Plans (not built)

Written down so a later change knows where this is going; none of it exists.

- **Grants as data.** Permissions stay in code (so every one has a guard), but which role holds which could move to rows (a role, a permission, and who granted it and when), so staff can be given one permission without a deploy, with an audit entry. `can()` would read the grants, with the bundles in code as the defaults.
- **Scopes.** A grant limited to a subset (one team's pages, one program's members). The check becomes `can(actor, permission, resource)`; the call sites that pass a resource today (a page's slug, a member id) are where it would start.
- **Other apps.** The registry, the roles map and `can()` are the part that doesn't depend on the Hub: the guards (`admin-auth.ts`, `api-auth.ts`) and the path table are the glue to copy.
