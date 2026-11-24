# Row Level Security (RLS) Implementation

> **Status:** living. **Last reviewed:** 2026-11-24. Review: yearly. Kept up to date with the code; if it is wrong, fix it.

## Overview

How Row Level Security is set up for the Hedgie Hub: roles, table policies, helper functions and the guards that keep them in place.

## Current State

Row level security is on for every table in `public` and `bronze`, and `supabase/tests/database/security_guards.test.sql` fails CI for a table without it (enable it in the migration that creates the table). Access is not "everyone signed in may do everything": each table has policies for the identities that need it, and grants that say no to the rest. Table privileges, policies and function guards are all pinned by pgTAP tests (`pnpm test:pgtap`).

## Who is asking: database roles and staff roles

Two different things are called a role here.

**Database roles** (what Postgres and Supabase's API see):

- `anon`: a signed-out request. It holds no privilege on any table in `public` or `bronze` (see "Table privileges"). It may run exactly one `SECURITY DEFINER` function, `is_admin()`, which returns false when signed out.
- `authenticated`: every signed-in request, member or staff. What it may touch is decided by grants and policies. The app's own pages and actions run as this role through the user's session (`src/lib/supabase/server.ts`), with the `x-acting-as` header added while an admin is in sudo.
- `service_role`: the server's own key. It bypasses row level security (`src/lib/supabase/service.ts`, `getServiceRepos()` in `src/lib/data/server.ts`).

**Staff roles** (what the Hub knows about a person): `admin`, `assistant`, `community_manager` and `conversion_specialist`, held as rows of `user_roles` (a person may hold several; a member holds none). They are bundles of permissions in code (`src/lib/permissions.ts`, `docs/architecture/PERMISSIONS.md`), and the application's guards ask about permissions. The database sees only the roles through helper functions. The old `user_profiles.role` column is gone (`supabase/migrations/20271110000000_drop_user_profiles_role.sql`).

The assistant has no role helper in the database: `is_admin()` is true only for the `admin` role, so an assistant passes the application's guards but its own client reads only what a plain signed-in user may (`docs/architecture/PERMISSIONS.md`, "The assistant"; `docs/TODO.md`, "Back the assistant role in the database").

## Helper functions

Policies call small `SECURITY DEFINER` functions instead of querying role tables themselves, so they work through row level security. The latest definitions:

- `is_admin()`, `is_community_manager()`, `is_conversion_specialist()`: true when `auth.uid()` holds that role in `user_roles`, through `user_has_any_role(user, roles)`, which no client can call (`supabase/migrations/20271028000000_user_roles.sql`, with `user_has_any_role` last replaced in `20271110000000_drop_user_profiles_role.sql`). `is_admin()` is only the `admin` role and is never widened for another role.
- `current_member_id()`: the `members.id` of the signed-in user, matched by `members.user_id` first and by the token's email second (`20261215000000_short_ids_tier1.sql`, the latest definition; the id is text).
- `current_acting_as_member_id()`: the member an admin is acting as in sudo, read from the `x-acting-as` request header, honored only when it names the caller's own user id and the caller is an admin (same migration).
- `can_own_care_plans(user)` and the course and chat helpers (`has_course_access`, `can_open_lesson`, `chat_can_see_channel`, `chat_can_read_content`, `chat_is_channel_member`, `chat_visible_channel_ids`), which `security_guards.test.sql` lists as recognized caller checks, each built on the base helpers.

In a policy, wrap a call as `(SELECT public.is_admin())` or `(SELECT auth.uid())`, as the migrations below do, so it is evaluated once per statement.

## Typical policy patterns

Policies are written `TO authenticated`; none are written for `anon`. Real examples:

- **Staff by role.** Read-only for admins: `20270120000000_ignored_zoom_appearances.sql` (one `FOR SELECT`, `INSERT` and `DELETE` policy each on `is_admin()`), and `20260926000700_restrict_member_readable_data.sql` for the raw-import tables in `bronze`. A role other than admin gets its own policies beside the admin's, never a wider `is_admin()`: `20270930000000_conversion_specialist_role.sql` gives the conversion specialist the landing page and outreach tables, and only the `members` rows with status `lead` or `cancelled` (`is_conversion_specialist() AND status IN ('lead', 'cancelled')`).
- **Own rows, or admin.** `member_activities` in `20260926000700_restrict_member_readable_data.sql`: `member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin())`. The same file does it for `members` with `user_id = auth.uid()` or the token's email, or admin. Writes to the member's own tables (writing projects, goals, books) use `current_member_id()` so a member whose login email differs from their member email still owns their rows (`20261001000000_owner_policies_use_current_member_id.sql`, tested by `supabase/tests/database/owner_policies_current_member_id.test.sql`).
- **A user's own rows plus admin.** `user_roles` in `20271028000000_user_roles.sql`: a user reads their own rows, admins read, give and take away; the auth service's role gets a read for the access token hook. Who may change whose roles is enforced by a trigger as well (`docs/architecture/PERMISSIONS.md`).
- **Readable by every signed-in member.** `member_directory` (`20260926000700_restrict_member_readable_data.sql`): `FOR SELECT TO authenticated USING (true)`, with `REVOKE ALL ... FROM anon`. There is no "public read" for signed-out visitors through the API; signed-out pages read through the service role after their own checks.
- **No policy at all.** A table or bucket only the service role touches has RLS on, no policy and no `authenticated` grant (see "Storage buckets" for buckets, and `.claude/rules/data-architecture.md` for the Slack content tables, whose sensitive columns are hidden with column grants).

Policies on one table are OR'd together, so a new policy can only widen access: read the table's existing ones first.

## Storage buckets

Files live in Supabase Storage buckets, and `storage.objects` has row level security like any table. Two kinds of bucket:

- **Server-only (no policy, on purpose):** `media` (the media library, `docs/product/MEDIA_LIBRARY.md`), `help-images`, `course-files` and `slack-files`. With RLS on and no policy, the API (anon and signed-in members alike) can't list, read or write them; only the service role can. The app checks who is asking and streams the file (`/api/media/<id>/<preset>`, `/api/courses/image/...`, the chat and course file routes). The Supabase dashboard shows "0 policies" for these: that is the locked-down state, not a gap. Don't add a policy to open one; if a member needs something, add a route that checks them. `supabase/tests/database/storage_buckets.test.sql` fails if a policy names one of them.
- **Members write to their own folder:** `feedback-screenshots` (the feedback widget uploads a PNG with the member's own session; a policy allows `<their user id>/...`, and the bucket limits it to a PNG of at most 5 MB) and `event-photos` (admins only; limited to 25 MB a photo). A bucket like this needs a policy for each action, and a size limit and MIME types where the content is predictable: the default limit is 50 MB of anything.

A bucket with a limit set says it in the dashboard; "Unset (50 MB)" is the project default. `book-covers` (public, members could write to it) and `course-images` are retired: nothing uses them, and a bucket can only be deleted through the Storage API or the dashboard, not SQL.

## Table privileges (grants)

Row level security decides which rows a role sees; grants decide whether it may touch the table at all. Both should say no to what the role never needs. The signed-out role (`anon`) holds no privileges on any table in `public` or `bronze` (`supabase/migrations/20270818000000_revoke_anon_table_privileges.sql`): signed-out pages and routes use the service role (after their own check), and everything signed-in runs as `authenticated`. That migration also changed the default privileges of the migration role, so `anon` gets nothing on new tables and sequences and a new table starts closed. `supabase/tests/database/anon_has_no_table_privileges.test.sql` fails if `anon` holds a privilege on any table or view in either schema, or a freshly created table gets one; it also checks that `authenticated` and `service_role` keep theirs. If a table ever has to be readable signed-out, grant that one privilege in its migration with the reason beside it, and change the test's expectation for it. Functions are separate: `is_admin()` keeps its execute grant for `anon`.

Supabase no longer grants Data API access to new tables on its own, so a migration that creates a table writes its grants itself, only what the table needs: `authenticated` for what signed-in requests do through RLS, `service_role` for server code, column-level `GRANT SELECT (col)` where columns are hidden, and no grants at all for a table only the service role uses (`.claude/rules/supabase-table-grants.md`). Its example block also shows a grant to `anon`; for `public` tables that now contradicts the anon test above, so leave `anon` out.

## Security definer functions and the guard

A `SECURITY DEFINER` function runs with its owner's rights, so it skips row level security and the caller's grants. One that signed-in users can execute must check who is calling. `supabase/tests/database/security_guards.test.sql` (with the check that every table in `public` and `bronze` has RLS on) fails CI when a function in `public` that `anon` or `authenticated` can execute:

- has no recognizable caller check in its body (`auth.uid()`, `auth.role()`, `auth.jwt()`, `is_admin()`, `is_community_manager()`, `current_member_id()`, `current_acting_as_member_id()`, or a helper built on them such as `has_course_access` or the `chat_*` visibility helpers), and is not a reviewed exception;
- does not set its `search_path`; or
- is executable by `anon`, other than `is_admin()` (it returns false when signed out).

**The limit.** The test proves a check exists, not that it is correct or on every path. A human reads each new definer function in its PR: what it reads or writes, who can call it, and whether it checks the caller before touching data. Prefer a check in the body; revoke `EXECUTE` from `public` and `anon` in the migration and grant only what is needed. A new definer function pins `search_path = public, pg_temp` (or `""` with every name qualified): `.claude/rules/migrations.md`, enforced by `security_definer_review.test.sql`. The 2026-11-21 read of every callable one, with a row per function, is `docs/trust/SECURITY_DEFINER_REVIEW.md`; `supabase/tests/database/security_definer_review.test.sql` adds guards for a pinned `search_path` on every function in `public` and for dynamic SQL (a callable definer function that builds SQL must be on its reviewed list).

**Adding a reviewed exception** (a function that deliberately returns data meant for any signed-in member, or only delegates to one that checks): add one line to `reviewed_exceptions` in the test with the signature, a one-line reason and the PR where it was reviewed. A stale entry (the function is gone, or now has a check) fails the test, so the list stays honest. The current ones: the member directory's alias list and search (aliases of directory-visible members only), per-mentor match counts (members cannot read the matches table, and badges need the counts), and a one-line wrapper over a checked function. `get_profile_writing` returns only items a member marked to show on their profile, and needs no exception.

## Service role and API routes

Server code uses the service role (`createServiceRoleClient()`, `getServiceRepos()`, or the client `createApiAuth` returns) for work no member's session could do: imports, webhooks, cron jobs, Slack content, signed-out pages. RLS does not protect those queries, so the caller must be checked first, and scoped to the caller's own rows where it is a member's request. The proxy treats every `/api/` route as public, so each route authenticates itself: a staff session with `requireApiPermission(request, "<permission>")`, a member session, the cron secret or the service key (`src/lib/supabase/api-auth.ts`), or a webhook's own signature or token. `tests/lib/api-route-auth.test.ts` lists every route file with its credential kind and fails on one with none (`docs/trust/THREAT_MODEL.md`, A01). Tables are reached through the repositories in `src/lib/data/`, where the client you pass decides the privilege (`.claude/rules/data-access-layer.md`).

## Adding a policy for a new table

1. In the migration that creates the table: `ENABLE ROW LEVEL SECURITY` (the guard test fails without it), an `id text DEFAULT public.new_id('<prefix>')`, and the grants it needs, as above. Start with none for `anon`.
2. Write a policy for each group that should reach it, `TO authenticated`, using the helpers: own rows with `(SELECT public.current_member_id())`, staff with `(SELECT public.is_admin())` or the role's own helper. If a staff role beyond admin needs the table through its own client, add `is_<role>()` policies beside the admin's (never widen `is_admin()`), and the permission in code (`docs/architecture/PERMISSIONS.md`, "Adding a permission"). Server-written tables need no policy and no `authenticated` grant.
3. Give the table a repository in `src/lib/data/` and regenerate types (`pnpm types:gen`).
4. Add a pgTAP test in `supabase/tests/database/` that signs in as each kind of caller (own, other member, staff, signed out) and checks what each can and cannot read or write; it should fail without the grant (`.claude/rules/supabase-table-grants.md`). Run `pnpm test:pgtap`.
5. Migrations follow `.claude/rules/migrations.md` (numbering, expand then contract, `pnpm check:migrations`).

## Security Considerations

- **Default deny**: with RLS on, a request with no matching policy sees nothing.
- **Service role bypass**: the service role skips RLS; see "Service role and API routes".
- **SECURITY DEFINER**: helper functions run with elevated privileges; see the guard above.
- **Policy overlap**: multiple policies are OR'd together, so be mindful of granting too much access.

## References

- [Supabase RLS Documentation](https://supabase.com/docs/guides/auth/row-level-security)
- `docs/architecture/PERMISSIONS.md`, `docs/trust/SECURITY_DEFINER_REVIEW.md`, `docs/trust/THREAT_MODEL.md`
- Migrations: `supabase/migrations/20260405172401_setup_rls_and_user_profiles.sql` (first setup), `20271028000000_user_roles.sql` (roles), `20270818000000_revoke_anon_table_privileges.sql`
- Tests: `supabase/tests/database/security_guards.test.sql`, `anon_has_no_table_privileges.test.sql`, `storage_buckets.test.sql`, `user_roles.test.sql`
