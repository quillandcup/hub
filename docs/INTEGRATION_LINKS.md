# Integration Links

Quick reference for managing all external service integrations. These dashboards are hard to find — bookmark this file.

Rotating a credential (or all of them, after an exposure)? See `docs/SECRET_ROTATION.md` for
the step-by-step per-service runbook — this file has the dashboard links, that one has the
"how to actually rotate it without breaking something" steps.

## Secrets at a glance

Every secret, where to create or rotate it, and how the new value reaches where it's used.
Values live in `.env.shared` / `.env.prod` / `.env.preview` (gitignored); after changing one,
run the sync in the last column, then redeploy (`gh workflow run ci.yml --ref main`) for
Vercel values. `env-vars.config.ts` is the source of truth for which var goes where.

| Secret | Create / rotate it at | Then |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` (and the public anon key) | https://supabase.com/dashboard/project/bxwtougjidectvjegdlr/settings/api | `npm run env:sync` |
| `SUPABASE_ACCESS_TOKEN` | https://supabase.com/dashboard/account/tokens | `npm run env:sync:github` |
| `SUPABASE_DB_PASSWORD` | https://supabase.com/dashboard/project/bxwtougjidectvjegdlr/settings/database -> Reset database password | `npm run env:sync:github` |
| `ZOOM_CLIENT_SECRET` | https://marketplace.zoom.us/develop/apps/gcFgx-76S8aaL4AiYqaHng/credentials | `npm run env:sync` |
| `ZOOM_WEBHOOK_SECRET_TOKEN` | https://marketplace.zoom.us/develop/apps/gcFgx-76S8aaL4AiYqaHng/event-subscriptions | `npm run env:sync` |
| `KAJABI_CLIENT_SECRET` | https://app.kajabi.com/admin/settings/public_api | `npm run env:sync` |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | https://console.cloud.google.com/iam-admin/serviceaccounts?project=quillandcup -> Keys | `npm run env:sync` |
| `GOOGLE_OAUTH_CLIENT_SECRET` | https://console.cloud.google.com/apis/credentials?project=quillandcup | `npm run env:sync` |
| `SLACK_BOT_TOKEN` | https://app.slack.com/app-settings/T01NPHKSMA9/A0AS93BKT09/oauth (read the runbook first: rotating uninstalls the bot) | `npm run env:sync` |
| `SLACK_SIGNING_SECRET` | https://api.slack.com/apps/A0AS93BKT09/general -> App Credentials -> Regenerate | `npm run env:sync` |
| `SLACK_CONFIG_REFRESH_TOKEN` | https://api.slack.com/apps -> "Your App Configuration Tokens" (below the app list) -> Generate Token; copy the refresh token | `gh secret set SLACK_CONFIG_REFRESH_TOKEN --repo quillandcup/hub` (never synced: CI rewrites it every run) |
| `GH_TOKEN_SLACK_MANIFEST` | https://github.com/settings/personal-access-tokens -> fine-grained, owner `quillandcup`, this repo only, **Secrets: Read and write** | `npm run env:sync:github` |
| `STRIPE_API_KEY` | https://dashboard.stripe.com/apikeys | `npm run env:sync` |
| `RESEND_API_KEY` | https://resend.com/api-keys | `npm run env:sync:github`, then the next push to main (or `npm run config:push`) updates Supabase's SMTP password |
| `SENTRY_AUTH_TOKEN` | https://quillandcup.sentry.io/settings/auth-tokens/ | `npm run env:sync:github` |
| `CHECKLY_API_KEY` | https://app.checklyhq.com/settings/user/api-keys | `npm run env:sync:github` |
| `CHECKLY_HEARTBEAT_*` | Each heartbeat monitor's ping URL, under https://app.checklyhq.com/accounts/6d3ea8e9-8978-4a8b-9721-ef77984bd1f7/checks | `npm run env:sync` |
| `VERCEL_TOKEN` | https://vercel.com/account/tokens (team-scoped, not project-scoped) | `npm run env:sync:github` |
| `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | IDs, not credentials: https://vercel.com/quillandcup/hub/settings | `npm run env:sync:github` |
| `SUDO_SECRET`, `CRON_SECRET` | Self-generated: `openssl rand -hex 32` | `npm run env:sync` |
| `CRON_INTERNAL_SECRET` | Self-generated: `openssl rand -hex 32` | `npm run env:sync` and `npm run env:sync:vault` |
| `GOOGLE_CALENDAR_WEBHOOK_TOKEN` | Self-generated; set when registering the watch channel (`WEBHOOK_SETUP.md`) | Vercel dashboard only (not in `env-vars.config.ts` yet) |

Per-service gotchas (what breaks mid-rotation, how to verify it took) are in
`docs/SECRET_ROTATION.md`.

## Alert routing

Every system that sends alerts uses the same per-environment destinations:

- **Email**: `ALERTS_EMAIL` -- check `.env.prod` / `.env.preview` (declared in `env-vars.config.ts`).
- **Slack channel**: not set up yet. When it exists, add its ID as a per-environment var the same way.

| System | Where it's configured | Status |
|---|---|---|
| Checkly (uptime, SSL, cron heartbeats) | Code: `__checks__/alert-channels.ts` reads `ALERTS_EMAIL` | Production address |
| Sentry (error alerts) | Sentry UI: Alerts -> rules, filtered by environment (`production` / `preview`, from `NEXT_PUBLIC_SENTRY_ENVIRONMENT`) | Set each rule's action to that environment's address |
| Vercel (deploy failures) | Per-user notification settings; Vercel Alerts needs Observability Plus (not enabled) | Not routable per environment today |
| GitHub Actions (failed runs) | Per-user notification settings | Not routable per environment today |

## Zoom

**App:** https://marketplace.zoom.us/develop/apps/gcFgx-76S8aaL4AiYqaHng/credentials

| Page | URL |
|------|-----|
| Credentials | https://marketplace.zoom.us/develop/apps/gcFgx-76S8aaL4AiYqaHng/credentials |
| Event Subscriptions (webhook URL + events) | https://marketplace.zoom.us/develop/apps/gcFgx-76S8aaL4AiYqaHng/event-subscriptions |
| App Information | https://marketplace.zoom.us/develop/apps/gcFgx-76S8aaL4AiYqaHng/information |

Webhook URL: `https://hub.quillandcup.com/api/webhooks/zoom`
Webhook secret env var: `ZOOM_WEBHOOK_SECRET_TOKEN`

---

## Slack

**App:** https://api.slack.com/apps/A0AS93BKT09

| Page | URL |
|------|-----|
| Event Subscriptions (webhook URL) | https://api.slack.com/apps/A0AS93BKT09/event-subscriptions |
| OAuth & Permissions (bot token) | https://app.slack.com/app-settings/T01NPHKSMA9/A0AS93BKT09/oauth |
| Basic Information (signing secret) | https://api.slack.com/apps/A0AS93BKT09/general |
| App Manifest (read-only view of what's live) | https://app.slack.com/app-settings/T01NPHKSMA9/A0AS93BKT09/app-manifest |
| App Configuration Tokens (below the app list; not the app's "App-Level Tokens") | https://api.slack.com/apps |

Webhook URL: `https://hub.quillandcup.com/api/webhooks/slack`
Signing secret env var: `SLACK_SIGNING_SECRET`

The app's configuration is defined as code in `slack-app-manifest.yml` and pushed by the
`push-slack-manifest` job in `.github/workflows/ci.yml` after each production deploy -- edit
the manifest, not the dashboard (dashboard edits get overwritten on the next push to main).
The job authenticates with an App Configuration Token: `SLACK_CONFIG_REFRESH_TOKEN`, a GitHub
secret CI rewrites on every run. Setup, `npm run slack:manifest:diff` and recovery:
`docs/SLACK_MANIFEST.md`.

---

## Google Calendar / Google Cloud

**Calendar API (project: quillandcup):** https://console.cloud.google.com/apis/api/calendar-json.googleapis.com/metrics?project=quillandcup

| Page | URL |
|------|-----|
| Service Accounts | https://console.cloud.google.com/iam-admin/serviceaccounts?project=quillandcup |

Calendar ID: `dd6745e544f1a8a93f0f7fd6d3fc633ab9c864e1090603a793c69d101f695e6e@group.calendar.google.com`
Service account: `quill-cup-admin-portal@quillandcup.iam.gserviceaccount.com`

Webhook URL: `https://hub.quillandcup.com/api/webhooks/calendar`
Webhook token env var: `GOOGLE_CALENDAR_WEBHOOK_TOKEN`

Note: Google Calendar webhooks are push notifications set up via API call (not a UI toggle). See `WEBHOOK_SETUP.md` for the `curl` command to register a watch channel.

---

## Kajabi

| Page | URL |
|------|-----|
| Dashboard | https://app.kajabi.com/admin/sites/2147577478/dashboard |
| API Keys | https://app.kajabi.com/admin/settings/public_api |
| Webhooks | https://app.kajabi.com/admin/sites/2147577478/integrations/webhooks |

Site ID: `2147577478`
Client ID: `2cSHfWmtiVw7By2axBgQrPdi`

Note: Kajabi webhooks only support "Payment Succeeded" and "Cart Purchase" events — we don't use them. The Silver layer is reconciled nightly at 3 AM via `/api/reconcile/members` (Vercel cron), but that only reprocesses existing Bronze snapshots — getting fresh data from Kajabi still requires a manual CSV import.

---

## Vercel

**Project:** https://vercel.com/quillandcup/hub

| Page | URL |
|------|-----|
| Deployments | https://vercel.com/quillandcup/hub/deployments |
| Logs (unified) | https://vercel.com/quillandcup/hub/logs |
| Analytics | https://vercel.com/quillandcup/hub/analytics |
| Speed Insights | https://vercel.com/quillandcup/hub/speed-insights |
| Environment Variables | https://vercel.com/quillandcup/hub/settings/environment-variables |
| Deploy Hooks | https://vercel.com/quillandcup/hub/settings/git#deploy-hooks |
| Domains | https://vercel.com/quillandcup/hub/settings/domains |

Production URL: `https://hub.quillandcup.com`

Note: production deploys no longer happen automatically on push to `main` (see
`vercel.json`'s `git.deploymentEnabled`) -- they're triggered by a Deploy Hook called
as the last step of `.github/workflows/ci.yml`, after tests pass and migrations push.

---

## Supabase

| Environment | URL |
|-------------|-----|
| Production | https://supabase.com/dashboard/project/bxwtougjidectvjegdlr |
| Development | https://supabase.com/dashboard/project/odgzkogzmzcnwgyfqvvt |

---

## Sentry

**Org:** https://quillandcup.sentry.io (region: EU/Frankfurt -- data residency for GDPR, see project history)

| Page | URL |
|------|-----|
| Issues | https://quillandcup.sentry.io/issues/?project=&statsPeriod=24h |
| Performance/Traces | https://quillandcup.sentry.io/insights/frontend/ |
| Session Replay | https://quillandcup.sentry.io/replays/ |
| Org Settings (slug, general) | https://quillandcup.sentry.io/settings/organization/ |
| Auth Tokens (org-level, for CI) | https://quillandcup.sentry.io/settings/auth-tokens/ |
| Project Settings (hub) | https://quillandcup.sentry.io/settings/quillandcup/projects/hub/ |

Org slug is `quillandcup` (confirmed 2026-09-25 -- an earlier note here claimed a rename
attempt to this slug "didn't take" and that `quill-cup` was canonical; that was wrong/stale,
the rename did take). `next.config.ts`'s `withSentryConfig({ org: "quillandcup", ... })`
already matches this. Org ID `4512131993501696` and project ID `4512132010672208` are what's
actually baked into the DSN, unaffected by any slug renaming either way.

DSN env var: `NEXT_PUBLIC_SENTRY_DSN` (all environments; read by the client, server and edge configs, no fallback in code), `SENTRY_AUTH_TOKEN` (GitHub secret passed to the CI build;
production-only source-map upload -- org-level tokens only offer one scope preset, `org:ci`,
which bundles Source Map Upload + Release Creation + Code Mappings; nothing to individually
select).

---

## Checkly

**Account:** https://app.checklyhq.com/accounts/6d3ea8e9-8978-4a8b-9721-ef77984bd1f7

| Page | URL |
|------|-----|
| Checks (uptime, SSL, cron heartbeats) | https://app.checklyhq.com/accounts/6d3ea8e9-8978-4a8b-9721-ef77984bd1f7/checks |
| Alert Channels | https://app.checklyhq.com/accounts/6d3ea8e9-8978-4a8b-9721-ef77984bd1f7/alerts/settings |
| Billing / Plan | https://app.checklyhq.com/accounts/6d3ea8e9-8978-4a8b-9721-ef77984bd1f7/billing |

Checks are defined as code in `__checks__/` and `checkly.config.ts`, deployed via
`.github/workflows/checkly.yml` -- edit the code, not the dashboard, for anything
that should persist (dashboard edits get overwritten on the next `checkly deploy`).

Account is on the Trial plan, expected to convert to free Hobby (no card on file) --
worth checking the Billing page above once the trial period ends.

---

## GitHub Actions

**Repo:** https://github.com/quillandcup/hub

| Page | URL |
|------|-----|
| Actions runs | https://github.com/quillandcup/hub/actions |
| Secrets & Variables | https://github.com/quillandcup/hub/settings/secrets/actions |
| Fine-grained personal access tokens (for `GH_TOKEN_SLACK_MANIFEST`) | https://github.com/settings/personal-access-tokens |

Secrets: `CHECKLY_API_KEY`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`,
`VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `SENTRY_AUTH_TOKEN`, `RESEND_API_KEY`,
`GH_TOKEN_SLACK_MANIFEST`. Variables: `CHECKLY_ACCOUNT_ID`, `SUPABASE_PROJECT_ID`, `ALERTS_EMAIL`, `SLACK_APP_ID`.
Secrets/variables synced from `.env.prod` via `scripts/sync-to-github.ts` (`npm run env:sync:github`) -- see `env-vars.config.ts` at the repo root for the source-of-truth list of which vars go where.

Two exceptions to the sync:

- `SLACK_CONFIG_REFRESH_TOKEN` (secret) is seeded by hand with `gh secret set` and then
  rewritten by CI on every run, so it has no copy in `.env.prod`. See `docs/SLACK_MANIFEST.md`.
- `GH_TOKEN_SLACK_MANIFEST` is synced like the rest, but it's a personal token rather than a
  service credential: a fine-grained token owned by `quillandcup`, limited to this repo, with
  **Secrets: Read and write** only. It lets the Slack manifest job save that rotated token
  (the workflow's built-in `GITHUB_TOKEN` can't write secrets). It expires on the date chosen
  at creation; the job fails once it lapses.

---

## Google Analytics

**Dashboard:** https://analytics.google.com/analytics/web/#/a190881256p555427327/reports/intelligenthome

GA4 property measurement ID `G-M3GTTL7SX8` (`NEXT_PUBLIC_GA_ID`). Account `a190881256`,
property `p555427327`.

Consent Mode v2 gates EU/UK visitors behind an accept/decline banner
(`components/ConsentBanner.tsx`) before firing; everyone else gets GA with no prompt.
