# Development Guidelines for Hedgie Hub

Next.js 15 App Router on Vercel (Pro; routes capped at 300s, see `maxDuration`), Supabase (Postgres, RLS on, invite-only Auth). Domain rules live in `.claude/rules/`: the ones with `paths:` load only when you touch matching files, the rest always load. Process rules (PRs, CI, branches, migrations' workflow, TODOs, public-repo hygiene) are in the unscoped files there.

## Commands

- `pnpm dev` / `pnpm build` / `pnpm lint`
- `pnpm typecheck`: **never bare `tsc --noEmit`**; it runs `next typegen` first (`PageProps`/`LayoutProps` come from `.next/types`). A clean run is zero errors.
- `pnpm test:unit`, `pnpm test:db` (local Supabase stack), `pnpm test:pgtap` (SQL/RLS), `pnpm test:smoke`
- `pnpm types:gen` after a migration (commit `src/lib/data/database.types.ts`), `pnpm check:migrations`
- Every worktree has its own `node_modules`: if `next` or `tsc` is missing, run `pnpm install --frozen-lockfile`, then check your change. Never report "not installed" as the reason a check was skipped.

## Repo layout

- Application code is under `src/`: `src/app/`, `src/components/`, `src/lib/`, `src/emails/`, `src/content/`, `src/modules/` (the composition root and the modules that contribute to the host, today the events integration for the page builder: `docs/architecture/PAGE_BLOCKS.md`; the pages code never imports a module, lint enforces it; `src/modules/chat/slack` is the Slack adapter of chat, and chat core in `src/lib/chat` and `src/components/chat` reaches it only through the transport port: `docs/architecture/CHAT_MODULE.md`, lint enforces it too), plus `src/proxy.ts`, `src/instrumentation.ts` and `src/instrumentation-client.ts`. `@/` means `src/` (so `@/lib/x` is `src/lib/x.ts`); `@/config`, `@/scripts` and `@/tests` still reach those root folders. `public/` stays at the root. Always write a path with its `src/` (`tests/lib/source-layout.test.ts` fails on `lib/x.ts` for `src/lib/x.ts`), and test files go in `tests/`, not next to the code.
- `src/app/(member)/`, `src/app/(admin)/admin/`, `src/app/api/` (process, import, reconcile, webhooks, internal), `src/app/actions/`
- `src/lib/` (domain logic), `src/lib/data/` (repositories, the only place that queries tables), `src/components/`, `src/emails/`
- `config/` (app.ts and env-vars.ts, the config-as-code YAML for GitHub, Sentry, Slack, Vercel and Mux, Sentry init, vitest, eslint, tailwind, squawk, knip, jscpd, osv-scanner, gitleaks, a PostCSS plugin), `supabase/migrations/`, `supabase/tests/database/` (pgTAP), `tests/` (`lib`, `api`, `components`), `docs/`
- `docs/` is sorted by whether a doc is living or a snapshot (index in `docs/README.md`). Living docs (`runbooks/`, `checklists/`, `architecture/`, `infrastructure/`, `trust/`, `product/`) are maintained with the code: a change that makes one wrong fixes it in the same PR. `decisions/` holds snapshots, a decision or analysis as of a date, kept unchanged as history. Every doc opens with a `> **Status:**` line saying which; `tests/lib/docs-layout.test.ts` enforces it. Living docs also carry `**Last reviewed:**` and a review cadence (quarterly for `checklists/`, yearly otherwise); the weekly "Docs overdue for review" issue lists what is due, and when you edit a doc to make it correct, bump its Last reviewed date. New decisions are ADRs in `docs/decisions/` (see its README). `docs/TODO.md` stays at the top.
- Data layers: Bronze (raw imports) → Local (app-owned) → Silver (reprocessable from Bronze + Local) → Gold (on demand)

## Universal rules

- **Pagination**: Supabase returns at most 1000 rows per query. Page with `fetchAllRows` (`src/lib/supabase/paginate.ts`) or a repository, never a bare `select("*")` on a table that can grow.
- **Tables are queried through `src/lib/data/` repositories**, not `.from("<table>")` in pages, actions or routes.
- **Batch database work** in API routes (load reference data with `Promise.all`, process in memory, write in chunks); no sequential queries in loops.
- **Member data in member pages** comes from `getEffectiveIdentity`, so sudo works.
- **Show members by `getMemberDisplayName`**, not `member.name`.
- **Staff pages, actions and routes** start with `requirePermission("<permission>")` / `requireActionPermission(...)` / `requireApiPermission(request, ...)`: access is by permission, roles are bundles (`src/lib/permissions.ts`, `docs/architecture/PERMISSIONS.md`).
- **Anything sent to a member on the app's initiative** goes through `createNotifier`, never a direct Slack call.
- **New tables** get `id text DEFAULT public.new_id('<prefix>')`, grants in the same migration, and a repository. Never expose a Tier 2 id.
- **Migrations never remove what live code still uses** (expand, then contract in a second PR).
- **Times are Eastern for the org** (`ORG_TIMEZONE`); never the server's zone.
- **Every behavior change ships with tests**; critical data routes need pagination, idempotency and reprocessability tests.

### No Hardcoded Config

**RULE**: Deployment/org config (URLs, hosts, emails, timezones, IDs, slugs) lives outside the code, never as literals or `??` fallbacks: `config/app.ts` (read via `src/lib/config.ts`) when it is the same in every environment, an env var declared in `config/env-vars.ts` when it is a secret or not fit to publish (the repo is public). Adding one: `.claude/rules/new-env-var.md`. Tests assert against the imported config values, not repeated literals.

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
| `permissions-for-resources.md` | a new resource or operation defines its permissions: verbs, role decisions, guard, RLS, audit, tests |
| `migrations.md`, `config-as-code.md` | numbering, expand/contract, squawk; Supabase, GitHub, Sentry, Slack manifest as code |
| `testing-requirements.md` | integration, route, component, pgTAP, fake clock |

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
