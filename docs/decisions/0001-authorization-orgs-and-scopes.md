# 0001. Authorization, organizations and scopes

Status: accepted
Date: 2026-11-21

## Context

Today the Hub answers "may this person do this?" with a permission registry in code (`PERMISSIONS`), four staff roles that are bundles of permissions, and one check, `can(actor, permission)` (`docs/architecture/PERMISSIONS.md`). Each person has one role (`user_profiles.role`); the change to several roles per person is in progress. Row-level security (RLS) in the database is the other half of the gate.

That model is right for one organization with a small staff. Three pressures push on it:

- **Finer grants.** Staff will need a permission limited to a subset (one group's pages, one program's members), and people who are not staff need to see exactly what concerns them.
- **More than one organization.** The design must allow one deployment to serve several independent organizations, where one person may belong to more than one. A design that assumes a single organization turns into a rewrite later.
- **Leaving a hosted platform.** The Hub is moving from invite-only access to self-signup, so who may join, and in what state, becomes a policy rather than a hand-kept list.

We want one vocabulary and one shape for authorization that holds for these cases, without building any of it before something needs it. This record fixes the shape and the words. It builds nothing.

## Decision

### 1. Two planes

- The **access plane** answers "what may this login do?": users, orgs, teams, permissions, roles and grants.
- The **domain plane** describes the world: **parties** (people and entities), **relationships** between them (owns, manages, belongs to, with percentages and date ranges) and **resources**.

A login (a user) is not a party. A link table connects them: a user can represent several parties, and a party can have no user at all. The Hub already has this split: members are imported before they have a login, and a login that has not been matched to a member is a normal state.

### 2. Vocabulary and isolation

- The isolation boundary is an **org**. We do not say "tenant" for it: in some domains that word means a person who rents a place, and the two meanings collide.
- In an app that serves several orgs, every row carries `org_id` and every RLS policy includes it.
- **Pooled isolation**: one database, `org_id` on rows, RLS to enforce it. The org id is the shard key, so a large org can later move to its own database without changing the data model.
- **Schema-per-org and database-per-org are rejected.** Every migration would become an operation across a fleet, and the number of schemas or databases would grow with the number of orgs.

### 3. Grants and scopes

A **grant** is `(subject, role, scope, valid_from, valid_to)`. The subject is a user or a team. Scopes nest inside an org (for example org, then group, then resource). The effective permissions at a place are the **union of the roles granted at that scope and every scope above it**.

- **Permissions are code**: operations, each with a guard, as now. **Roles are bundles** of permissions. Every check goes through one function.
- `user_roles` (several roles per user, the expand step being built now) is the grants table without the scope column. Adding scope, validity dates and team subjects later extends it; it does not replace it.
- **Teams** are optional groups used to assign a grant to many people at once. Nothing requires them.

### 4. Two sources of access

1. **Explicit grants**, for staff: someone was given a role at a scope.
2. **Relationship-derived access**, for everyone else: a person sees what their party holds a stake in, reached through a hierarchy of entities; a person sees their own lease, enrolment or order; an external party sees what is assigned to them.

Derived access is computed from domain data, through a SQL function or view. If walking the hierarchy is too slow inside RLS, we add a **materialized effective-access table** (who may see which resource and why), refreshed when the underlying relationships change. We benchmark early, before committing to either form (see open questions).

### 5. Role versus relationship

A **staff role** (access plane: "community manager") and a party's **relationship to a resource** (domain plane: "owns 30 percent of", "is assigned to") are different things. Keep the words apart in code, schema and docs. Do not name a column `role` when it holds a relationship, or the reverse.

### 6. External actors

Vendors, customers and members of a hosted community are a distinct **actor type from day one**, not staff with fewer permissions. They may belong to several orgs and see only what is assigned to them or what they hold. Their access is relationship-derived (decision 4) unless someone grants them a role explicitly.

### 7. Verbs and shapes

This matches `.claude/rules/permissions-for-resources.md`, written alongside this record. If the two ever differ, the rule file is the working text and this record is the reasoning.

- **Verbs**: `read` (covers list and open by default), `list` (only where the summary differs from the detail), `create`, `edit`, `publish`, `delete`, `import`, `export` and `bulk`.
- **`import` and `export` are separate permissions.** They touch many records at once, bring in outside data or send data out, and so have a larger blast radius. No permission implies another: a role that holds `edit` does not thereby hold `import`. Roles are the bundling mechanism.
- **Instance checks answer yes or no** ("may this person open this record?").
- **Collection checks return a filter**, not an error ("which records may this person see?"). The filter is applied inside the repositories, which are the only place that query tables (`docs/architecture/DATA_ACCESS_LAYER.md`), so a page cannot forget it.
- **Live updates** follow `read`: RLS governs what realtime delivers. Exceptions get their own permission: broadcast and presence channels, payloads that carry more than the list shows, and outbound subscriptions (webhooks and feeds). A standing subscription is re-checked when a role changes, so revocation takes effect on open connections.
- **Notification subscriptions** are preferences, gated by `read`, and handled by the notifier (`createNotifier`), never by a direct send.

### 8. Field-level cuts

RLS filters rows, not columns. A sensitive field (a note, contact data) gets a view or a security-definer function that returns only what the caller may see, rather than relying on the application to drop the column.

### 9. Audit

- The audit log records row changes. Permissions name operations. Each mutating permission names the log entry it produces.
- **Denied attempts** are a separate security signal, not audit entries, per the existing audit rules (`docs/architecture/ACTIVITY_AND_AUDIT_LOG.md`).
- **Granting and removing a role is audited.**
- **"View as"** (sudo or preview) is itself auditable and **never changes what the database allows**: it changes what the application shows, using the real person's access.

### 10. Signup and membership policy, per org

Each org chooses how people join: **open**, **invite-only** or **approval**. A membership has a state: **pending**, **active** or **banned**. The Hub is invite-only today and moves to self-signup when it leaves its external course and payment platform; the policy is the setting that changes, not the code that reads it.

### 11. Per-org configuration as data

Values in `config/app.ts` that are really about one org (name, URL, timezone, branding, integrations) become **org settings** read through a **resolver**. Code asks the resolver, not a constant. Values that are the same in every org and every environment stay in `config/app.ts`; secrets stay in env vars (`CLAUDE.md`, "No Hardcoded Config").

Rule for new tables: once multi-org is decided for an app, a new table carries `org_id` from the first migration. Until then, **route org-level reads through one function**, so adding the org later is a mechanical change at a few call sites.

**Retrofitting the Hub's roughly 300 tables is a separate campaign** (expand, backfill, constrain, then contract; `.claude/rules/migrations.md`). It starts only when a second consumer is committed, not before.

### 12. Rollout

- **Done**: the permission registry and four roles, merged (`src/lib/permissions.ts`; the read-only Roles page).
- **In progress**: several roles per user (`user_roles`, the expand step).
- **Next, each when a consumer needs it**: an org resolver seam (decision 11), grants with a scope (decision 3), relationship-derived access (decision 4).
- **Nothing speculative is built.** Each step is small, ships with tests, and has a user waiting for it.

## Consequences

- One vocabulary (org, party, grant, scope, role versus relationship) for design discussion, schema and code review.
- `user_roles` is on the path: it is designed as a grants table minus a column, so the in-progress work is not thrown away.
- Pooled isolation keeps migrations a single operation and keeps a way out: a big org can be moved by shard key.
- RLS policies that walk a hierarchy cost more than a plain `org_id` check. We accept that and mitigate it with a materialized effective-access table if the benchmark says so; the cost is a refresh path that must be correct and reprocessable.
- Relationship-derived access means the domain data is part of the security model. A wrong relationship row is a wrong grant, so those tables need the same review and audit as grants.
- Collection checks returning filters means repositories take the actor as an input. That is more plumbing than a boolean, and it removes a class of "forgot to filter" bugs.
- Separate import and export permissions mean more entries in the registry and more role decisions; that is the intent.
- Until a second org exists, the Hub stays single-org; the resolver seam is the only change before then, so there is no cost to the product today.

## Alternatives rejected

- **Schema-per-org or database-per-org.** Stronger isolation on paper, but every migration is a fleet operation and per-org overhead grows without bound. Pooled isolation with the org id as shard key keeps the exit open.
- **Using "tenant" for the boundary.** Ambiguous in domains where a tenant is a person; "org" is unambiguous and short.
- **Permissions as rows in a table.** A permission could then exist without a guard. Keeping permissions in code means a review sees every new one; grants are the data.
- **Staff roles only (everyone with access is a role holder).** Cannot express "a person sees their own enrolment" without creating a role per record. Relationship-derived access covers it from data we already hold.
- **Treating a login as the party.** Breaks for people imported before they sign in, for one login acting for several parties, and for parties that never log in.
- **Role names on relationships (or the reverse).** Mixing the planes makes "role" mean two things in the same query.
- **Import and export implied by edit or read.** Hides the largest-blast-radius operations inside everyday permissions.
- **Per-org config left as code constants.** Fine for one org; every new org becomes a deploy.

## Open questions

- **Where reusable platform code lives long term.** It stays in this repository for now, as directories with lint-enforced boundaries (nothing outside imports a module's internals). A package or registry model comes later, if and when a second consumer needs it.
- **Licensing** of reusable platform code, if it is ever shared outside this repository.
- **How to benchmark hierarchy-resolving RLS**: which data shapes (depth, fan-out, number of stakes), what latency budget, and the point at which a materialized effective-access table pays for its refresh.
- **How impersonation is shown to the impersonated party**: whether and where a person sees that staff viewed or acted as them.
- **Retention per org**: whether audit, activity and tracking retention is one policy or a per-org setting, and what a leaving org takes with it.

## How Hub gets there

Small steps, in order, each when something needs it:

1. Finish `user_roles` (several roles per user) and move the guards to read it; contract the old single-role column in a second PR.
2. Add an **org resolver**: one function that returns the current org and its settings. Move the org-specific values in `config/app.ts` behind it one by one; new org-level reads call it from the start.
3. Add **scope** (and validity dates, and team subjects) to grants when the first scoped grant is needed. Extend `can(actor, permission)` to `can(actor, permission, resource)` at the call sites that already pass a resource.
4. Add **relationship-derived access** when the first non-staff consumer needs to see "their own" data through a stake or an assignment. Start as a SQL function; measure; add a materialized table only if the measurement says so.
5. Decide the **retrofit campaign** for `org_id` only when a second consumer is committed.

`docs/architecture/PERMISSIONS.md` ("Plans (not built)") is updated as each step lands; this record stays unchanged.
