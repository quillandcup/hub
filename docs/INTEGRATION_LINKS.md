# Integration Links

Quick reference for managing all external service integrations. These dashboards are hard to find — bookmark this file.

Rotating a credential (or all of them, after an exposure)? See `docs/SECRET_ROTATION.md` for
the step-by-step per-service runbook — this file has the dashboard links, that one has the
"how to actually rotate it without breaking something" steps.

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

Webhook URL: `https://hub.quillandcup.com/api/webhooks/slack`
Signing secret env var: `SLACK_SIGNING_SECRET`

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

DSN env vars: `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` (all environments), `SENTRY_AUTH_TOKEN`
(production-only, source-map upload -- org-level tokens only offer one scope preset, `org:ci`,
which bundles Source Map Upload + Release Creation + Code Mappings; nothing to individually
select).

---

## Checkly

**Account:** https://app.checklyhq.com/accounts/6d3ea8e9-8978-4a8b-9721-ef77984bd1f7

| Page | URL |
|------|-----|
| Checks (uptime + SSL monitors) | https://app.checklyhq.com/accounts/6d3ea8e9-8978-4a8b-9721-ef77984bd1f7/checks |
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

Secrets: `CHECKLY_API_KEY`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`,
`VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`. Variables: `CHECKLY_ACCOUNT_ID`, `SUPABASE_PROJECT_ID`.
Secrets/variables synced from `.env.prod` via `scripts/sync-to-github.ts` (`npm run env:sync:github`) -- see `env-vars.config.ts` at the repo root for the source-of-truth list of which vars go where.

---

## Google Analytics

**Dashboard:** https://analytics.google.com/analytics/web/#/a190881256p555427327/reports/intelligenthome

GA4 property measurement ID `G-M3GTTL7SX8` (`NEXT_PUBLIC_GA_ID`). Account `a190881256`,
property `p555427327`.

Consent Mode v2 gates EU/UK visitors behind an accept/decline banner
(`components/ConsentBanner.tsx`) before firing; everyone else gets GA with no prompt.
