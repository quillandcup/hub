# Development Guidelines for Hedgie Hub

Next.js 15 App Router on Vercel (Pro; routes capped at 300s, see `maxDuration`), Supabase (Postgres, RLS on, invite-only Auth). Domain rules live in `.claude/rules/`: the ones with `paths:` load only when you touch matching files, the rest always load. Process rules (PRs, CI, branches, migrations' workflow, TODOs, public-repo hygiene) are in the unscoped files there.

## Commands

- `pnpm dev` / `pnpm build` / `pnpm lint`
- `pnpm typecheck`: **never bare `tsc --noEmit`**; it runs `next typegen` first (`PageProps`/`LayoutProps` come from `.next/types`). A clean run is zero errors.
- `pnpm test:unit`, `pnpm test:db` (local Supabase stack), `pnpm test:pgtap` (SQL/RLS), `pnpm test:smoke`
- `pnpm types:gen` after a migration (commit `lib/data/database.types.ts`), `pnpm check:migrations`
- Every worktree has its own `node_modules`: if `next` or `tsc` is missing, run `pnpm install --frozen-lockfile`, then check your change. Never report "not installed" as the reason a check was skipped.

## Repo layout

- `app/(member)/`, `app/(admin)/admin/`, `app/api/` (process, import, reconcile, webhooks, internal), `app/actions/`
- `lib/` (domain logic), `lib/data/` (repositories, the only place that queries tables), `components/`, `emails/`
- `supabase/migrations/`, `supabase/tests/database/` (pgTAP), `tests/` (`lib`, `api`, `components`), `docs/`
- Data layers: Bronze (raw imports) → Local (app-owned) → Silver (reprocessable from Bronze + Local) → Gold (on demand)

## Universal rules

- **Pagination**: Supabase returns at most 1000 rows per query. Page with `fetchAllRows` (`lib/supabase/paginate.ts`) or a repository, never a bare `select("*")` on a table that can grow.
- **Tables are queried through `lib/data/` repositories**, not `.from("<table>")` in pages, actions or routes.
- **Batch database work** in API routes (load reference data with `Promise.all`, process in memory, write in chunks); no sequential queries in loops.
- **Member data in member pages** comes from `getEffectiveIdentity`, so sudo works.
- **Show members by `getMemberDisplayName`**, not `member.name`.
- **Admin pages and actions** start with `requireAdminPage()` / `requireAdminAction()`.
- **Anything sent to a member on the app's initiative** goes through `createNotifier`, never a direct Slack call.
- **New tables** get `id text DEFAULT public.new_id('<prefix>')`, grants in the same migration, and a repository. Never expose a Tier 2 id.
- **Migrations never remove what live code still uses** (expand, then contract in a second PR).
- **Times are Eastern for the org** (`ORG_TIMEZONE`); never the server's zone.
- **Every behavior change ships with tests**; critical data routes need pagination, idempotency and reprocessability tests.

### No Hardcoded Config

**RULE**: Deployment/org config (URLs, hosts, emails, timezones, IDs, slugs) lives outside the code, never as literals or `??` fallbacks: `app.config.ts` (read via `lib/config.ts`) when it is the same in every environment, an env var declared in `env-vars.config.ts` when it is a secret or not fit to publish (the repo is public). Adding one: `.claude/rules/new-env-var.md`. Tests assert against the imported config values, not repeated literals.

## Path-scoped rules (`.claude/rules/`)

| File | Covers |
|---|---|
| `api-routes-and-queries.md` | 1000-row limit, route performance, review checklist |
| `data-access-layer.md`, `attendance-table.md` | repositories (full table list), attendance records |
| `data-architecture.md`, `data-pipeline-reprocessability.md` | Bronze/Local/Silver/Gold, soft delete, webhooks + pull imports, DELETE+INSERT |
| `member-identity.md`, `display-names.md`, `hand-overs.md` | sudo identity, display names, accept-to-transfer |
| `member-notifications.md` | `createNotifier`, kinds, channels, message copy, dry-run rollout |
| `usage-analytics.md`, `audit-and-activity-log.md` | tracking plan, audit entries, Activity Log events |
| `keyboard-shortcuts.md` | the `?` panel registry, handler rules, drift tests |
| `tabbed-pages.md`, `ui-layout.md` | tabs are paths, container queries, named z-layers |
| `resource-ids.md`, `business-facts.md` | id tiers and prefixes, derive don't assume |
| `admin-route-protection.md` | admin pages/actions, community manager, preview role |
| `migrations.md`, `config-as-code.md` | numbering, expand/contract, squawk; Supabase, GitHub, Sentry, Slack manifest as code |
| `testing-requirements.md` | integration, route, component, pgTAP, fake clock |

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
