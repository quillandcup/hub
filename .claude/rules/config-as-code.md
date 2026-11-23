---
paths:
  - "supabase/config.toml"
  - "config/github.yml"
  - "config/sentry.yml"
  - "config/slack-app-manifest.yml"
  - "scripts/slack-manifest.ts"
  - "scripts/sentry-config.ts"
  - ".github/workflows/**"
---

### Supabase config as code

`supabase/config.toml` is the source of truth for the Auth/API/DB/storage settings it declares: the top of the file is local dev, and `[remotes.prod]` overrides it for production (project `bxwtougjidectvjegdlr`). Anything not overridden there, such as `[auth.hook.custom_access_token]`, applies to production as-is. `supabase config push` only writes declared properties; undeclared ones keep their dashboard values. So change declared settings in `config.toml`, not the dashboard, or the next push reverts them.

- **CI pushes it automatically.** On every push to main, the push-migrations job pushes migrations and then runs the "Push Supabase config" step (`supabase config push --yes`). That order is the rule: config can point at SQL (the access token hook → `public.custom_access_token_hook`), and pushing it before the SQL exists breaks every sign-in and token refresh. The step refuses to run if the `RESEND_API_KEY` GitHub secret is empty, since the push fills the SMTP password from `env(RESEND_API_KEY)` and would otherwise clear it (the secret is declared in `config/env-vars.ts`; sync with `pnpm env:sync:github`).
- **Leaked password protection** (`password_hibp_enabled`) has no `config.toml` key, so the next step in that job, "Enable leaked password protection", turns it on through the Management API. Don't turn it off in the dashboard; the next push to main turns it back on.
- Before merging a `config.toml` change, run `pnpm config:diff` (read-only diff against production) and make sure it shows only the change you intend. Expected, harmless lines: `auth.sms.twilio.enabled` and `storage.image_transformation.enabled` show as remote-only.
- `pnpm config:push` still works for a manual push (needs `RESEND_API_KEY` in `.env.prod`); follow the same SQL-before-config order.
- The Dashboard equivalent for the hook: Authentication → Hooks → Customize Access Token (JWT) Claims → Postgres function `public.custom_access_token_hook`.
- Where local defaults differ from production's values (auth email rate limit, storage analytics/vector), `[remotes.prod]` pins production's values so a push doesn't change them. If `config:diff` shows anything besides the change you intend, pin or fix it in `config.toml` before pushing.
- Local: the auth container reads hooks only at startup, so after changing `[auth.hook.*]` restart the stack (`supabase stop && supabase start`; no reset needed).

### GitHub repo settings as code

`config/github.yml` is the source of truth for the repo's settings (`workflow_permissions:`, the default token permission (`read`) and whether workflows may approve PRs; `settings:`, today `allow_auto_merge: true`, which `.github/workflows/auto-merge.yml` relies on to enable auto-merge on every new non-draft PR: it squash-merges itself once the required checks pass; open a draft or click "Disable auto-merge" to hold one back; it re-checks on every push, since a PR opened while conflicting never got it, but never after you turned it off) and rulesets (today: `main` requires the `Test (unit)`, `Test (db) & build`, `Coverage report`, `Check migrations`, `Code quality gate` and `CodeQL` (code scanning: no new alerts in the PR) checks, needs every PR review thread resolved (bots' included; no approvals required), and can't be deleted or force-pushed; nothing is pushed to `main` directly, admins included, so land changes through a PR, where an admin can still override with "Merge without waiting for requirements"). `pnpm github:config:diff` previews against the live repo (read-only) and `pnpm github:config:push` applies it; both go through `gh` and need repo admin, since Actions' `GITHUB_TOKEN` can't manage rulesets, so this is run by hand. A push replaces a declared ruleset's settings, so change the file, not the Settings page. When a CI job is renamed or added, update the required check names there. The coverage floors are `AREA_FLOORS` in `scripts/coverage-report.ts`. Rulesets on a private repo need a paid GitHub plan; the org is on the free plan.

### Sentry config as code

`config/sentry.yml` is the source of truth for the Sentry organization's data-scrubbing settings (server-side scrubbing, default scrubbers, no IP storage) and for the project's issue alert rules (`alerts:`, the CSP alerts; only rules named `Hub: ...` are managed, deleting one from the file deletes it from Sentry). On a push to main that changes it or `scripts/sentry-config.ts`, after the production deploy, the `push-sentry-config` job applies it, so change the file, not the Settings page. `pnpm sentry:config:diff` previews against the live organization (read-only). Needs the `SENTRY_CONFIG_TOKEN` secret, an internal integration token, not the build token `SENTRY_AUTH_TOKEN`. Session Replay masking is in code (`src/instrumentation-client.ts`, `data-sentry-unmask`), retention is Sentry's plan. Details: `docs/infrastructure/SENTRY_CONFIG.md`.

### Slack app manifest as code

`config/slack-app-manifest.yml` is the source of truth for the Slack app (Billie Bot), including its `incoming-webhook` scope (the audit workflow's #hub-alerts webhook; the webhook URL itself is added in the dashboard after a reinstall, `docs/infrastructure/SLACK_MANIFEST.md`). On a push to main that changes it or `scripts/slack-manifest.ts` (or a manual `workflow_dispatch` run), after the production deploy (the manifest points at app routes, so they must be live first), the `push-slack-manifest` job runs `scripts/slack-manifest.ts push`, which **replaces** the live app's configuration. Anything set in the Slack dashboard but missing from the manifest is removed, so change the manifest, not the dashboard. Before merging a manifest change, run `pnpm slack:manifest:diff` (read-only) and check it shows only what you intend. `SLACK_CONFIG_REFRESH_TOKEN` is rewritten by CI on every run and is deliberately not in `config/env-vars.ts`. Setup, token rotation and recovery: `docs/infrastructure/SLACK_MANIFEST.md`.
