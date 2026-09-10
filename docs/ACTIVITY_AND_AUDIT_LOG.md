# Activity log vs. audit log

Two distinct systems, both "who did what when," but with a different subject — kept as two tables rather than one shared table.

## `member_activities` — the activity log

Subject is always a CRM person (`member_id`). This is a live table (not new) — written by the Slack import pipeline and writing-progress actions, and now also by prickle attendance (mirrored), outreach touches, and Hedgie Hub logins. Read by engagement scoring (`lib/member-engagement.ts`) and the admin member activity feed.

- **`actor_kind`** (`'member' | 'staff' | 'system'`) + **`actor_user_id`**: makes the direction of an action explicit — the member did this themselves, a staff member did this on/with them (e.g. an outreach touch), or a pipeline/system produced it — instead of implying it from `activity_type` naming.
- **`data` JSONB** (renamed from `metadata`): the event's actual content — an email's subject/body, a DM's text, a Slack message's channel info. This is the event's data, not secondary metadata about it. `description` stays as a short plain-text snippet for list views.
- **`source`**: which pipeline/table produced this row (`'slack'`, `'prickle_attendance'`, `'outreach_touches'`, `'access_events'`, ...). Combined with `related_id`, this points back to the origin row.
- Two write patterns in use:
  - **DELETE+INSERT by source + date range** (Slack, prickle attendance) — fully reprocessable, matches the Silver-layer convention in CLAUDE.md.
  - **Best-effort single insert alongside the primary action** (writing-progress, outreach touches, logins) — append-only, not reprocessed; a failure here is logged but never blocks the primary write.

## `audit_log` — not built yet

Subject is any resource (`entity_type`, `entity_id`) — model-level naming, not raw SQL `table_name`/`record_id`, so the audit log's vocabulary doesn't churn if a table gets renamed later (this codebase has already renamed `attendance` → `prickle_attendance` once). Most audited resources have no associated member at all (a `prickle_type`, a `badge_type`, a program's settings) — this is why it isn't the same table as `member_activities`.

- **Actor**: always a Hedgie Hub authenticated user, or system. Two ways to capture it:
  - Prefer writes to go through the *acting user's own* authenticated Supabase client, so a trigger can read `auth.uid()` directly — the same transaction-scoped, per-request mechanism RLS already relies on (PostgREST sets it from the caller's JWT at the start of every request). Nothing custom needed.
  - Where a write genuinely must use a service-role client, route it through a Postgres function taking `p_changed_by uuid` as an **explicit parameter**, passed into the audit insert within that same function call. Not an implicit session variable (`SET LOCAL`) — a value set in one `supabase-js` call wouldn't survive into a separate call, since PostgREST wraps each request in its own transaction.
- **Mechanism**: a generic Postgres `AFTER INSERT OR UPDATE OR DELETE` trigger attached per audited table — not an app-code/ORM mixin. This codebase has no ORM/model layer (plain `supabase-js` calls throughout), so there's no Rails-PaperTrail-style seam to hook into; a trigger is actually the more complete option anyway, since it catches every write path (API routes, cron jobs, a manual fix in the SQL editor) rather than only calls that remembered to opt in.
- **`changes` JSONB**: stores only the delta per changed field (`{"status": {"old": "lead", "new": "active"}}`), not full before/after row snapshots — that's what makes "what changed" a glance at the JSON keys instead of a diff computed at render time.
- **`comment` TEXT** (optional): the "why," captured the same way as the actor when required.

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
