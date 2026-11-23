---
paths:
  - "src/lib/permissions.ts"
  - "src/lib/admin-paths.ts"
  - "src/lib/data/**"
  - "src/app/(admin)/**"
  - "src/app/api/admin/**"
  - "supabase/migrations/**"
  - "docs/architecture/PERMISSIONS.md"
  - "tests/lib/permissions.test.ts"
  - "tests/lib/permission-guards.test.ts"
---

## permissions-for-resources

**RULE**: A new kind of resource, or a new operation on one, defines its permissions in the same PR, the way it ships its Activity Log events (`audit-and-activity-log.md`). The mechanics of a guard are in `admin-route-protection.md` and `docs/architecture/PERMISSIONS.md`; this is what to decide before you write the guard.

Scope: path-scoped, because it matters when you touch the registry, a staff page or action, a repository or a migration (the places a resource appears), and would be noise in every other session. A resource that starts somewhere else (a member-facing page) is covered by the last section below.

**What a PR that adds a resource or operation contains**
1. **The permissions**, named `<resource>.<verb>` in `PERMISSIONS`, each with a one-line description of what it lets a person do.
2. **A decision for every role** in `ROLE_PERMISSIONS` and in the table in `tests/lib/permissions.test.ts`. The default is none; the admin holds everything (the assistant too, less `ASSISTANT_WITHHELD`). A role gets it on purpose, with a reason in the PR.
3. **The guard**: `requirePermission` on the page, `requireActionPermission` in each action, `requireApiPermission` in each route, a line in `ADMIN_PAGE_PERMISSIONS`.
4. **RLS policies** when a role's own client reads or writes the table (`is_<role>()` beside `is_admin()`, never a widened `is_admin()`), with a pgTAP test.
5. **An Activity Log entry** for each mutating permission (see "Audit" below).
6. **Tests**: the role table, the guard, and the behavior (allowed and denied).

**Standard verbs**
- `read`: covers listing and opening a record. `list` only when the list shows less than the detail does (summary fields against the full record), so a role can see that a work order exists without reading it.
- `create`, `edit`, and `publish` where the thing has a draft state (`pages.publish`), `delete`.
- `import` and `export` are their own permissions, apart from `create` and `edit`: they move many records, or data from or to outside, with a bigger blast radius.
- `bulk` for an operation on many records at once (`members.bulk_merge`).
- `manage` only as a coarse bundle of the rest, for an area too small to split yet (`outreach.manage`); split it when a role needs part of it.
- **No implication between permissions.** Holding `import` does not give `create`, and `edit` does not give `read`. A role is the bundle, so list everything it needs. The admin holds all of them.

**Collections and single records**
- A single record is allow or deny: the guard refuses.
- A collection returns what the person may see, not an error: apply the filter in the repository (and RLS), so a role with a narrower view gets a shorter list, not a failed page.
- **Watching live updates** follows `read` (RLS decides what realtime delivers; `use-realtime.mdc`). A separate permission only for broadcast or presence channels, a payload that carries more than the list shows, and outbound subscriptions (webhooks, feeds). A standing subscription must be re-checked or closed when a role changes.

**Pipelines**: an import that runs from cron or a webhook runs as the system with its secret and needs no permission. A person-initiated import that creates one record may stay under `create` or `edit`; a person-started bulk import is `import`.

**Audit**: a mutating permission names the Activity Log entry it produces (the event, and the sentence `describeRow` shows). `read`, `list` and an export that changes nothing write none, unless `audit-and-activity-log.md` says that kind of read is recorded. A test that maps each mutating permission to its entry is not built yet (`docs/TODO.md`, "Map each mutating permission to its Activity Log entry"); until then, check it by hand and say which entry in the PR.

**What the checks cover.** `tests/lib/permissions.test.ts` fails when a permission has no decision for a role, names an unknown one, or lacks a description; `tests/lib/permission-guards.test.ts` fails on an admin page, action or staff route without a known guard and on a permission nothing uses (list it in `RESERVED_PERMISSIONS` with "no surface yet" until it does).

**Not covered yet: member-facing resources.** The guard test scans only the staff area. A resource members use, or one with a staff-only operation outside `src/app/(admin)/`, is not scanned. Today: check with `can(actor, permission)` for a staff operation, or the ownership check (`getEffectiveIdentity`) for a member's own record, in the page, action or route itself, and add a test of the denied case. The gap is recorded in `docs/TODO.md`, "Guard coverage for member-facing resources".
