# Activity log vs. audit log

Two distinct systems, both "who did what when," but with a different subject — kept as two tables rather than one shared table.

## `member_activities` — the activity log

Subject is always a CRM person (`member_id`). This is a live table (not new) — written by the Slack import pipeline and writing-progress actions, and now also by prickle attendance (mirrored), outreach touches, and Hedgie Hub logins. Read by engagement scoring (`lib/member-engagement.ts`) and the admin member activity feed.

- **`actor_kind`** (`'member' | 'staff' | 'system'`) + **`actor_user_id`**: makes the direction of an action explicit — the member did this themselves, a staff member did this on/with them (e.g. an outreach touch), or a pipeline/system produced it — instead of implying it from `activity_type` naming.
- **`data` JSONB** (renamed from `metadata`): the event's actual content — an email's subject/body, a DM's text, a Slack message's channel info. This is the event's data, not secondary metadata about it. `description` stays as a short plain-text snippet for list views.
- **`source`**: which pipeline/table produced this row (`'slack'`, `'prickle_attendance'`, `'outreach_touches'`, `'access_events'`, ...). Combined with `related_id`, this points back to the origin row.
- Two write patterns in use:
  - **DELETE+INSERT by source + date range** (Slack, prickle attendance) — fully reprocessable, matches the Silver-layer convention in CLAUDE.md.
  - **Best-effort single insert alongside the primary action** (writing-progress, outreach touches, logins, prickle commitments -- see `docs/COMMITMENTS.md`) — append-only, not reprocessed; a failure here is logged but never blocks the primary write.

## `audit_log` — the audit log

Built in `20261006000000_create_audit_log.sql`. Subject is any resource (`entity_type`, `entity_id`) — model-level naming, not raw SQL `table_name`/`record_id`, so the audit log's vocabulary doesn't churn if a table gets renamed later (this codebase has already renamed `attendance` → `prickle_attendance` once). Most audited resources have no associated member at all (a `prickle_type`, a `badge_type`, a program's settings) — this is why it isn't the same table as `member_activities`.

- **Actor**: always a Hedgie Hub authenticated user, or system. Two ways to capture it:
  - Prefer writes to go through the *acting user's own* authenticated Supabase client, so a trigger can read `auth.uid()` directly — the same transaction-scoped, per-request mechanism RLS already relies on (PostgREST sets it from the caller's JWT at the start of every request). Nothing custom needed.
  - Where a write genuinely must use a service-role client, route it through a Postgres function taking `p_changed_by uuid` as an **explicit parameter**, passed into the audit insert within that same function call. Not an implicit session variable (`SET LOCAL`) — a value set in one `supabase-js` call wouldn't survive into a separate call, since PostgREST wraps each request in its own transaction.
- **Mechanism**: a generic Postgres `AFTER INSERT OR UPDATE OR DELETE` trigger attached per audited table — not an app-code/ORM mixin. This codebase has no ORM/model layer (plain `supabase-js` calls throughout), so there's no Rails-PaperTrail-style seam to hook into; a trigger is actually the more complete option anyway, since it catches every write path (API routes, cron jobs, a manual fix in the SQL editor) rather than only calls that remembered to opt in.
- **`changes` JSONB**: stores only the delta per changed field (`{"status": {"old": "lead", "new": "active"}}`), not full before/after row snapshots — that's what makes "what changed" a glance at the JSON keys instead of a diff computed at render time.
- **`comment` TEXT** (optional): the "why," captured the same way as the actor when required.

### What is audited today

`audit_row_change(entity_type, pk_columns)` is attached to every table staff can write: members and their overrides/aliases/hiatus history, `user_profiles`, `staff`, prickle types/schedules/host vibes, badges and awards, programs/cohorts/enrollments, segments, feature flags and previews, events, outreach leads, work-queue completions, restricted Slack channels (the full list is the `VALUES` block in the migration, plus `20261009000000` for the last). To audit another table, add a row there in a new migration (`CREATE TRIGGER audit_row_change AFTER INSERT OR UPDATE OR DELETE ... EXECUTE FUNCTION audit_row_change('<entity>', '<pk>')`).

**Member actions** (`20261006100000`): the same trigger is on the tables members write themselves, so what a member does is recorded with the right actor, and in sudo with the admin as actor and the member as `acting_as`: writing projects, goals and starting balances, progress entries (UPDATE/DELETE only; logging one is already mirrored into `member_activities`), bookshelf, prickle commitments (UPDATE/DELETE only, same reason), the calendar link and calendar items added by hand, Wheel of Wonder spins (the spinner is the subject; `audit_row_change` falls back to `spinner_member_id`), "Ask me about" topics, plus the profile/alias tables above. A member's own edits are `actor_kind = 'member'` and so show under **Everything** but not the **Audit** view, unless made in sudo (an admin's, so audit-worthy). `describeRow` in `lib/activity-feed.ts` turns them into sentences ("added writing project “Moon Garden”", "spun the Wheel of Wonder", "added their calendar link to a calendar app").

- **Redaction**: `audit_row_change(entity, pk, redact_cols)` takes an optional third argument, a comma-separated list of columns logged as changed but never with their value. The calendar feed token uses it, since the token is the only credential for that URL.
- **Calendar link installed**: `calendar_feed_tokens.first_fetched_at` is stamped once by the feed route on the first fetch by a calendar app (a `system` audit row about the member) and cleared when the link is regenerated. Later polls write nothing.

- **Names on every row**: `audit_log.entity_label` holds the record's title/name/alias/award name (set by the trigger), returned by the feed as `description`, so an UPDATE row can say which project it was about. A project's status change reads "moved writing project “X” from drafting to on hold"; a `member_books` row with a `project_id` came from Publish ("published “X” from a writing project"), one without was added directly ("added “X” to their bookshelf").
- **Check-ins and check-outs** (utilization of the feature): `prickle_checkins` stays private, but a trigger (`prickle_checkins_log_activity`) writes a `member_activities` row (`prickle_checkin` / `prickle_checkout`, `engagement_value` 0) when each half is first answered, edited (`prickle_checkin_updated`) or cleared (`prickle_checkin_cleared`; same for `checkout`), never with the answers. A Slack DM saves one field at a time, so a change within 10 minutes of that half's last row folds into it instead of logging again. `data.via` is `web` or `slack` (from `prickle_checkins.saved_via`, set by `writeCheckin`; the Slack DM path passes `"slack"`), shown as "(via Slack)". Find them under Everything → Member activity.

Deliberately **not** audited: member-private data (notes, check-ins, onboarding, notification preferences, writing-prompt dismissals), append-only logs, and `outreach_touches` (already mirrored into `member_activities` with `actor_kind = 'staff'`, which the feed treats as audit-worthy; auditing it too would double every row).

Details worth knowing:
- **Net effect per transaction.** `audit_row_change` folds a later UPDATE of a record into that transaction's earlier row for it (same `txid`, actor and sudo context): first old value, last new value, and the row is deleted if it all nets out. This matters for pipelines that write a row twice in one transaction: `reprocess_members_atomic` sets the Kajabi-derived status and then re-applies lifetime/gift, program-cohort and hiatus overrides, so a lifetime member used to log `active → cancelled` and `cancelled → active` on every run for no change. Rows from different transactions are never merged. A redacted column is never dropped as "reverted" (both sides read `[redacted]`). `20261013000100_audit_fold_historical_churn.sql` applied the same rule once to rows written before this existed, grouping UPDATE rows by record, actor and `occurred_at` (the transaction start).
- `actor_kind` is derived in the trigger: no `auth.uid()` → `system` (pipelines, cron, service-role writes), `admin`/`assistant` → `staff`, anyone else → `member`. Service-role writes made on behalf of a user show as `system` until they're routed through a function taking `p_changed_by` (see above).
- `updated_at`/`created_at` are excluded from `changes`, and an UPDATE that changes nothing else writes no row.
- `member_id` is filled from the row's `member_id` column (or `id` for `members`), which is what lets the member timeline merge audit rows in without resolving entities later.
- **Sudo records both people.** Sudo (`lib/sudo.ts`) only swaps the *effective member* in app code; `auth.uid()` stays the real admin, so the admin is the actor (`changed_by`) and the member they were viewing as goes in `acting_as_member_id`. The same column exists on `member_activities` and `access_events`. How it gets there: `lib/supabase/server.ts` forwards the HMAC-verified `sudo_as` cookie as an `X-Acting-As: <admin user id>:<member id>` header on the request-scoped Supabase client; PostgREST exposes it to triggers as `request.headers`; `current_acting_as_member_id()` honors it only when the header names the caller and the caller is an admin (a forged header from anyone else records nothing). `audit_row_change()` and a BEFORE INSERT trigger on `member_activities` (which also sets `actor_user_id` to the admin) read it, so every code path is covered with no per-call changes. The proxy writes `access_events.acting_as_member_id` itself from the cookie (RLS only lets admins set it). Not covered: service-role writes (recorded as `system`) and the one page that talks to the database from the browser (`admin/data-health/missing-hosts`, via `lib/supabase/client.ts`), whose writes carry the right actor (`auth.uid()`) but no sudo header. Everything else, including every member-facing write, goes through the server client.
- No FKs on `changed_by`/`member_id`: history outlives deleted users and merged members.
- Pipeline writes to `members` (`reprocess_members_atomic`) are `system` rows when a field actually changes.

## The central activity log (`/admin/activity`)

One page over **both** tables plus page visits, backed by the `get_activity_feed()` SQL function (admin-only via `is_admin()` inside; keyset-paginated on `occurred_at`). Each row is one of:

| `kind` | Source | `is_audit` |
|---|---|---|
| `audit` | `audit_log` | unless the actor is a member acting as themselves (not in sudo) |
| `activity` | `member_activities` | when `actor_kind = 'staff'` or an admin did it in sudo |
| `session` | `access_events`, sessionized per user (30-minute gap, split wherever `acting_as_member_id` changes), with the page trail in `data.pages`, shown grouped by place with counts (`summarizePages`) and the raw order behind a toggle | only for sudo visits |

The **Audit** button (the default) is `p_audit_only = true`: staff/system changes and anything done in sudo, but no email opens, prickle attendance or ordinary page visits. **Privacy** (`?view=privacy`, `p_entity_types`) shows only changes to who can read message content: today a Slack channel being restricted from staff or the restriction lifted (`restricted_slack_channel`), later break-glass grants and reads. Add an entity type to `PRIVACY_ENTITY_TYPES` in `lib/activity-feed.ts` to include it. **Viewed as member** (`?sudo=1`, `p_sudo_only`) narrows to just sudo activity; a member's timeline (`p_member_id`) includes an admin's sudo activity as that member. **Everything** drops that filter and adds per-kind chips. Filters are URL params (`?view=all&actor=<user id>&member=<member id>&sudo=1&days=30&page=2&pageSize=50`), so any filtered view is linkable. The table is the standard server-mode table (`useServerDataTable` + `DataTablePager`); `get_activity_feed` takes `p_offset`/`p_limit` and `count_activity_feed` gives the total. The Member picker (what they did, and what staff did for or as them; choosing one switches to Everything, since a member's own actions aren't in the Audit view) and the Staff member picker (narrows to one admin's actions) are one shared `components/EntitySearch.tsx` fed with data: `MemberSearch` (members) and `StaffSearch` (admins/assistants, keyed by user id) are thin wrappers. the per-user "Activity" modal on `/admin/users` links to the actor-filtered view. Code: `lib/activity-feed.ts`, `app/(admin)/admin/activity/` (`page.tsx`, `ActivityFilters.tsx`, `ActivityFeedTable.tsx`).

The same function takes `p_member_id`, so the CRM member-page timeline can reuse it (not wired up yet; see `docs/TODO.md`).

## Three views, mapped to the two tables

| View | Table(s) | Filter |
|---|---|---|
| Resource-centric (a "clock icon" on any record showing its change history) | `audit_log` | `entity_type = ? AND entity_id = ?` |
| User-centric (staff accountability — what did a given admin change) | `audit_log` | `changed_by = ?` |
| Member-centric (the CRM timeline for one person) | `member_activities` **and** `audit_log`, merged | `member_activities.member_id = ?` UNION `audit_log` rows whose `entity_type`/`entity_id` resolve to that member |

Only the member-centric view spans both tables — editing a member's own record is simultaneously a resource mutation (`audit_log`) and a meaningful event in their timeline (`member_activities`-adjacent). No shared row is needed for that; the view assembling it just queries both.

## Why not partition `member_activities`

Expected volume (tens of thousands to low millions of rows over a few years, at this community's scale) doesn't warrant partitioning — that typically starts paying off in the tens-of-millions+ range. A composite index on `(member_id, occurred_at)` covers the dominant query pattern instead. If actual volume or query latency ever demands it, partition by `occurred_at` (RANGE, e.g. monthly) — **not** by `member_id`. Both dominant query patterns (a member's timeline, and engagement scoring's "last 30 days" batch across every member) are time-windowed, so time-based partitioning lets Postgres prune old partitions entirely; member-hash partitioning wouldn't help the batch scoring query at all, since it fans out across many members regardless of which partition each one lands in.

## Why `prickle_attendance` stays a separate table

`member_activities` mirrors prickle attendance rather than replacing `prickle_attendance` as its store. `prickle_attendance` deliberately allows multiple rows per `(member_id, prickle_id)` to track leave/rejoin (see CLAUDE.md), which conflicts with `member_activities`'s one-row-per-event shape; a large existing surface of dashboards, at-risk detection, and host-participation queries also depends on `prickle_attendance`'s exact current shape. The mirror write happens inside `reprocess_prickle_attendance_atomic`, in the same transaction as the `prickle_attendance` write itself, so it can never drift out of sync with it — that atomicity is what makes treating `member_activities` as a trustworthy single input to engagement scoring safe.
