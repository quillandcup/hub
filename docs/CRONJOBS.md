# Scheduled Jobs (Cron)

This repo uses two scheduling mechanisms. There is no pg_cron usage
anywhere in this codebase (verified by grep across migrations and docs) —
don't add a third mechanism without updating this doc.

| Mechanism | When to use it |
|---|---|
| **Vercel Cron** (`vercel.json`) | Jobs that run entirely inside a Vercel serverless function: HTTP-callable, no browser needed, finishes within Hobby tier's duration limits (`maxDuration`, max 300s). |
| **GitHub Actions cron** (`.github/workflows/`) | Jobs needing a real browser (Playwright) or a longer runtime than Vercel's function limits allow. |

## Vercel Cron jobs

Configured in `vercel.json`. Vercel always invokes these via `GET`, authenticated
via `requireAdmin` (`lib/supabase/api-auth.ts`) recognizing the `CRON_SECRET`
bearer token (see `docs/SECRETS.md`). Each is a thin wrapper that delegates to
a `trigger*` helper in `lib/processing/trigger.ts`.

| Job | Schedule (UTC) | What it does |
|---|---|---|
| `/api/reconcile/calendar` | Daily 2:00am | Syncs Google Calendar events into Bronze (`calendar_events`), reprocesses the `prickles` Silver table. |
| `/api/reconcile/zoom` | Daily 2:30am | Imports Zoom attendance into Bronze (`zoom_attendees`/`zoom_meetings`), reprocesses the `attendance` Silver table. |
| `/api/reconcile/slack` | Daily 2:45am | Fetches recent Slack channel history (messages + reactions) into Bronze, reprocesses `member_activities`. Backstops the Slack Events API webhook — catches anything a missed or failed webhook delivery would otherwise drop permanently. |
| `/api/reconcile/members` | Daily 3:00am | Pulls contacts/customers/purchases/offers from the Kajabi API into Bronze, reprocesses the `members` Silver table (via `reprocess_members_atomic`). |

## GitHub Actions cron jobs

Configured in `.github/workflows/`.

| Workflow | Schedule (UTC) | What it does |
|---|---|---|
| `kajabi-product-progress-sync.yml` | Daily 6:00am | Playwright downloads Kajabi's Product Progress export (course completion/engagement — no API exists for this data, and the account has 2FA so login is done via a saved session, not credentials) and uploads it to `/api/import/kajabi-product-progress`, appending a snapshot into `bronze.kajabi_product_progress`. See `docs/KAJABI_PRODUCT_PROGRESS_SYNC.md` for the session-refresh runbook. |

## Adding a new scheduled job

1. Decide the mechanism using the table at the top of this doc.
2. Add it to `vercel.json` or `.github/workflows/` as appropriate.
3. Add a row to the relevant table above — this doc is the source of truth
   for "what runs on a schedule and why," since `vercel.json` and a workflow
   YAML alone don't explain intent.
