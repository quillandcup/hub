# Testing

> **Status:** living. **Last reviewed:** 2026-11-23. Review: yearly. Kept up to date with the code; if it is wrong, fix it.

How the project is tested, which tests exist to stop a mistake from coming back (the guard tests), and which lists of exceptions still hold work to clean up. The per-area rules for writing tests are in `.claude/rules/testing-requirements.md` and `.claude/rules/tests-with-every-change.md`; this is the map.

## The suites

| Suite | Command | Where | Needs |
|---|---|---|---|
| Unit | `pnpm test:unit` | `tests/lib`, `tests/components` (including `tests/components/pages`), `tests/calendar`, a few files in `tests/api` that need no database | nothing (runs in a non-UTC zone on purpose) |
| Db | `pnpm test:db` | `tests/api` (routes called in process with `tests/helpers/api-fetch.ts`), `tests/dashboard`, `tests/email` and repository contract tests (`tests/helpers/*-contract.ts`) | the local Supabase stack |
| pgTAP | `pnpm test:pgtap` | `supabase/tests/database/*.test.sql`: RLS, `SECURITY DEFINER` functions, the access token hook | the local Supabase stack |
| Smoke | `pnpm test:smoke` | `tests/api/smoke/`: the few real HTTP tests, for Next's own routing and body parsing | the stack and the built app |
| Page checks | nightly workflow | `tests/demo/`: Playwright scenes, with console, accessibility and overflow checks on every page they open | the demo stack |

`tests/lib/test-project-split.test.ts` keeps a test that needs the database out of the unit project, which runs in CI with no stack. Always run `pnpm typecheck` and `pnpm lint` with the tests; the unit job fails on lint errors.

## What CI enforces

- **Coverage.** `scripts/coverage-report.ts` merges the unit and db suites. `AREA_FLOORS` sets a minimum per area (`src/lib`, `src/components`, `src/app/api`), and the new-code gate requires `MIN_PATCH_SCORE` (80%) of added lines to be covered. Floors only go up. The README badges come from the same script.
- **Code quality gate** (`pnpm quality:gate`, `scripts/quality-gate.ts`): fails on new duplicate functions and identical branches on lines the change added, and on a new unused file or dependency that is not in `config/knip-baseline.json`.
- **Migrations**: `pnpm check:migrations` (ordering), squawk (`config/squawk.toml`), pgTAP.
- **Security scans**: CodeQL, OSV (new vulnerable dependencies), gitleaks, license policy (`pnpm check:licenses`, `config/license-policy.json`), the ZAP baseline (`config/zap-baseline.tsv`).
- **Docs**: `tests/lib/docs-layout.test.ts` (every doc has a Status line and a place), `tests/lib/source-layout.test.ts` (paths carry their `src/`).

## Guard tests

A guard test reads the source (or the database schema, or the docs) and fails when a rule is broken, so a mistake fixed once stays fixed. Each one points at the rule it protects, usually in `.claude/rules/`. When a guard fails, fix the code; add an exception only with a reason, in the guard's own list (below).

### Data and access

| Guard | Protects |
|---|---|
| `tests/lib/data-access-layer.test.ts` | Tables with a repository are queried only through `src/lib/data/` (census of direct `.from(...)` calls). |
| `tests/lib/typed-supabase-clients.test.ts`, `tests/lib/data-casts.test.ts` | Every client is typed with the generated `Database`; no casts that hide a column mistake. |
| `tests/lib/api-route-auth.test.ts` | Every route under `src/app/api` authenticates itself (the proxy treats `/api/` as public). |
| `tests/lib/permission-guards.test.ts` | Every admin page, action and staff route has a permission that exists and agrees with the proxy and sidebar. |
| `tests/lib/member-merge-coverage.test.ts` | Every table that references `members` is decided for the merge dialog. |
| `tests/lib/user-profiles-role-readers.test.ts` (and the pgTAP twin `user_roles_readers.test.sql`) | Nothing reads a role from `user_profiles`. |
| `tests/lib/staff-definition.test.ts`, `tests/lib/seed-sql.test.ts` | One definition of staff; no `TRUNCATE ... CASCADE` in the seed. |
| `supabase/tests/database/security_guards.test.sql` | Database-level security rules. |
| `tests/lib/member-display-names.test.ts` | Members are shown by `getMemberDisplayName`, not `name`. |
| `tests/lib/outcome-coverage.test.ts`, `tests/lib/outcome-wiring.test.ts` | Every server action records whether it worked. |

### Outbound requests and security

| Guard | Protects |
|---|---|
| `tests/lib/safe-fetch-callers.test.ts` | Requests to an address a member chose go through `src/lib/net/safe-fetch.ts` (SSRF). |
| `tests/lib/outbound-user-agent.test.ts` | Every outbound request identifies itself. |
| `tests/lib/html-sanitizers-xss.test.ts` | Both stored-HTML sanitizers against a wide XSS payload set. |
| `tests/lib/no-secret-logging.test.ts`, `tests/lib/workflow-heartbeat-masking.test.ts` | No credential in logs or Sentry events; Checkly ping URLs masked in public CI logs. |
| `tests/lib/no-external-stylesheets.test.ts` | No third-party stylesheet is requested at runtime. |
| `tests/lib/deploy-provenance-workflow.test.ts` | Deploy signing cannot break a deploy; actions are pinned. |
| `tests/lib/trust-no-provider-names.test.ts` | Public compliance pages name no vendor. |
| `tests/lib/zap-baseline-rules.test.ts` | The ZAP ignore list stays valid and explained. |

### Boundaries between parts of the code

| Guard | Protects |
|---|---|
| `tests/lib/client-server-boundary.test.ts`, `tests/lib/client-node-builtins.test.ts` | Client components never reach server-only or Node-only code. |
| `tests/lib/chat-core-boundary.test.ts` | Chat core reaches Slack only through the transport port (`docs/architecture/CHAT_MODULE.md`); ESLint enforces the same in `config/eslint.mjs`. |
| `tests/lib/page-block-boundary.test.ts` | The page builder never imports a module's internals (`docs/architecture/PAGE_BLOCKS.md`). |

### UI consistency

| Guard | Protects |
|---|---|
| `tests/lib/icons.test.ts` | Icons come from `src/components/Icon.tsx` (`.claude/rules/icons.md`). |
| `tests/lib/confirm-dialog.test.ts` | Confirmations use `ConfirmDialog`, never the browser's `confirm` (`.claude/rules/confirmations.md`). |
| `tests/lib/tooltip-native-title.test.ts`, `tests/lib/tooltips.test.ts` | Hints use `Tooltip` / `InfoTip`; no hover box that widens a phone page. |
| `tests/lib/viewport-layouts.test.ts`, `tests/lib/container-sizes.test.ts` | Layout inside the content area follows container queries and the named sizes, not the window. |
| `tests/lib/z-layers.test.ts`, `tests/lib/z-layer-pairs.test.ts` | Stacking uses the named layers, and overlapping pairs have the right winner. |
| `tests/lib/shortcut-listeners.test.ts`, `tests/lib/shortcuts.test.ts` | Page-wide key listeners are Escape-only or in the `?` panel registry. |
| `tests/lib/landing-theme-tokens.test.ts`, `tests/lib/landing-button-contrast.test.ts` | Landing pages use the semantic color tokens; buttons keep their contrast. |
| `tests/lib/site-pages.test.ts`, `tests/lib/track-names.test.ts` | Every page is in the search registry; analytics track names stay valid. |
| `tests/lib/naming-and-visibility-guards.test.ts` | "Writer profiles" wording everywhere; visibility words stay consistent. |

### Process and tooling

| Guard | Protects |
|---|---|
| `tests/lib/cron-heartbeats.test.ts` | Every cron job has a Checkly heartbeat or a stated reason, within the plan's monitor limit. |
| `tests/lib/docs-layout.test.ts`, `tests/lib/source-layout.test.ts`, `tests/lib/dev-tooling-layout.test.ts` | Doc status lines, `src/` paths, where tooling files live. |
| `tests/lib/supabase-cli-version.test.ts`, `tests/lib/test-project-split.test.ts` | One pinned CLI for generated types; db tests stay out of the unit project. |

A guard that checks other guards ("guards the guards", for example in `cron-heartbeats.test.ts`) proves its own check can fail; do the same when you add one.

## Exception lists with work left to clean up

Most guards keep a list of files that predate the rule or are allowed with a reason. **Shrink-only** lists fail in both directions: a new violation fails, and so does an entry that is no longer needed, so you cannot forget to delete it. When you touch a listed file, fix it and remove its entry.

### Debt: work left to do

| List | Where | Cleanup | Tracked in `docs/TODO.md` |
|---|---|---|---|
| `CONFIRM_BASELINE`: files still calling the browser's `confirm(` | `tests/lib/confirm-dialog.test.ts` | Move each to `ConfirmDialog` / `useConfirm()` | "Move the browser confirms onto ConfirmDialog" |
| `LUCIDE_BASELINE`: files importing `lucide-react` directly | `tests/lib/icons.test.ts` | Use `<Icon name=... />` | "Move Inline SVGs and Direct Lucide Imports to the Icon Set" |
| `SVG_BASELINE`: files with hand-pasted inline icons | `tests/lib/icons.test.ts` | Same; custom drawings that must stay go in `CUSTOM_DRAWINGS` with a reason | same entry |
| Chat core files that still import Slack code | `config/chat-core-baseline.json` (read by `chat-core-boundary.test.ts` and `page-block-boundary.test.ts`) | Move behind the transport port, one step at a time | "Chat core and Slack adapter: next steps" |
| Unused files and dependencies tolerated by the quality gate | `config/knip-baseline.json` | Delete the file or dependency, or use it | "Code quality: decide what to gate" |
| Page-check findings known today | `tests/demo/baseline.json` (`pnpm demo:baseline`) | Fix the finding; the nightly check fails on a stale entry | "Page checks: what is still in the baseline, and what they do not reach" |
| Server actions that record no outcome | `NOT_TRACKED` in `tests/lib/outcome-coverage.test.ts` | Wire to `withAction`, or confirm the reason still holds | (each entry states its reason) |

### Reasoned exceptions: review when you touch them

These are not debt by default. Each entry says why it is fine; a stale entry fails, so they cannot rot silently. If a reason no longer holds, remove the entry and fix the code.

| List | Where |
|---|---|
| `ALLOWED` (files that read `host.name` on purpose) | `tests/lib/member-display-names.test.ts` |
| `ALLOWED_RAW_FETCH` (raw `fetch(` allowed; "only ever shrinks") | `tests/lib/outbound-user-agent.test.ts` |
| `THROUGH_SAFE_FETCH`, `FIXED_HOST` (outbound calls that are safe by construction) | `tests/lib/safe-fetch-callers.test.ts` |
| `ALLOWED`, `ESCAPE_LISTENER_WITH_ELEMENT_KEYS` (listeners beyond Escape) | `tests/lib/shortcut-listeners.test.ts` |
| `ALLOWED` (layouts that are really the window's) | `tests/lib/viewport-layouts.test.ts` |
| `ALLOWED_TOOLTIP_ROLE`, `ALLOWED_HIDDEN_BOX` | `tests/lib/tooltips.test.ts` |
| `CUSTOM_DRAWINGS` (charts and brand marks that are not icons) | `tests/lib/icons.test.ts` |
| `EXCLUDED` (pages kept out of the site registry) | `tests/lib/site-pages.test.ts` |
| `PUBLIC_ROUTES`, `DELEGATES` (API routes without a session check) | `tests/lib/api-route-auth.test.ts` |
| `UNMIGRATED_TABLES`, `VARIABLE_TABLE_FILES` (direct table queries) | `tests/lib/data-access-layer.test.ts` |
| ZAP `IGNORE` and `OUTOFSCOPE` rules | `config/zap-baseline.tsv` |

To see what is left in any list right now, open the file named in the table; the list is at the top of each guard.

## Adding a guard

1. Write the rule first (in `.claude/rules/` or a doc) and make the test's header comment point at it and say how to fix a failure.
2. Start with a list of exceptions only if the codebase already breaks the rule; make it shrink-only (fail on stale entries) and open a `docs/TODO.md` entry for the cleanup, then add a row to the debt table above.
3. Prove the guard can fail: a test that feeds it a violating snippet.
4. Add it to the tables above.
