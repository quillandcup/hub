# Secrets & Environment Variables

Every secret/credential env var actually referenced in code, grouped by
integration. This list was built by grepping `process.env.` usage across
`app/`, `lib/`, and `scripts/` (not copied from `.env.example`) — at least
one variable in active use (`SUDO_SECRET`) was previously missing from
`.env.example`, which is why this doc exists as the checkable reference
instead.

**Keep this in sync**: when you add a new integration or secret, add a row
here (and to `.env.example` if it's needed for local development).

## Supabase

| Variable | Used by | Purpose | Where it's set |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | app-wide (`lib/supabase/client.ts`, `server.ts`, `middleware.ts`) | Supabase client config | `.env.local` (dev) / Vercel env (prod) |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin API routes, scripts, `requireAdmin` (`lib/supabase/api-auth.ts`) | Bypasses RLS for server-side/admin operations; also accepted as a bearer token by `requireAdmin` for server-to-server calls | Vercel env; GitHub Actions secret for the Kajabi Product Progress workflow |
| `SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN` | `scripts/sync-email-templates.ts` | CLI-only — syncing email templates to Supabase | Local shell env, not app runtime |

## Cron / internal auth

| Variable | Used by | Purpose | Where it's set |
|---|---|---|---|
| `CRON_SECRET` | `requireAdmin` (`lib/supabase/api-auth.ts`) | Bearer token Vercel Cron uses to call `/api/reconcile/*` routes | Vercel env only |
| `SUDO_SECRET` | `lib/sudo.ts` | HMAC-signs/verifies the admin sudo-mode cookie (`signSudoCookie`/`parseSudoCookie`) | `.env.local` / Vercel env — **add to `.env.example` if not already present** |

## Zoom

| Variable | Used by | Purpose | Where it's set |
|---|---|---|---|
| `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`, `ZOOM_USER_EMAIL` | `lib/zoom/client.ts` | Zoom API (attendance import) | `.env.local` / Vercel env |
| `ZOOM_WEBHOOK_SECRET_TOKEN` | `app/api/webhooks/zoom/route.ts` | Verifies Zoom webhook signatures | Vercel env (prod only) |

## Google Calendar

| Variable | Used by | Purpose | Where it's set |
|---|---|---|---|
| `GOOGLE_SERVICE_ACCOUNT_KEY`, `GOOGLE_CALENDAR_ID` | `lib/google-calendar/client.ts` | Calendar sync | `.env.local` / Vercel env |
| `GOOGLE_CALENDAR_WEBHOOK_TOKEN` | `app/api/webhooks/calendar/route.ts` | Verifies the calendar webhook channel token | Vercel env (prod only) |

## Kajabi

| Variable | Used by | Purpose | Where it's set |
|---|---|---|---|
| `KAJABI_CLIENT_ID`, `KAJABI_CLIENT_SECRET`, `KAJABI_SITE_ID` | `lib/kajabi/client.ts` | Kajabi OAuth API (contacts/customers/purchases/offers) | `.env.local` / Vercel env |
| `KAJABI_SESSION_STATE` | `scripts/kajabi-export.ts` | Base64-encoded Playwright `storageState` — a saved, already-authenticated Kajabi browser session, used because the account has 2FA and the Product Progress export has no API | GitHub Actions secret only — see `docs/KAJABI_PRODUCT_PROGRESS_SYNC.md` |

## Slack

| Variable | Used by | Purpose | Where it's set |
|---|---|---|---|
| `SLACK_BOT_TOKEN` | Slack API calls (message history import, feedback widget, `scripts/export-slack-data.ts`, Kajabi sync failure alert) | Slack Web API auth | `.env.local` / Vercel env; also a GitHub Actions secret for the Kajabi Product Progress workflow |
| `SLACK_SIGNING_SECRET` | `app/api/webhooks/slack/route.ts` | Verifies Slack webhook signatures | Vercel env (prod only) |
| `SLACK_FEEDBACK_CHANNEL_ID` | `app/api/feedback/route.ts` | Destination channel for feedback-widget submissions | `.env.local` / Vercel env |
| `SLACK_ALERT_CHANNEL_ID` | `.github/workflows/kajabi-product-progress-sync.yml` | Destination channel for the Kajabi sync failure alert | GitHub Actions secret only |

## Stripe

| Variable | Used by | Purpose | Where it's set |
|---|---|---|---|
| `STRIPE_API_KEY` | `lib/stripe/client.ts` | Stripe reconciliation | `.env.local` / Vercel env |

## GitHub Actions — deployment target

| Variable | Used by | Purpose | Where it's set |
|---|---|---|---|
| `APP_URL` | `scripts/upload-kajabi-product-progress.ts` | Base URL the upload step POSTs the Kajabi export to | GitHub Actions secret only |
