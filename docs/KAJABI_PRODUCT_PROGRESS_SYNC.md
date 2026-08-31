# Kajabi Product Progress Sync

Kajabi has no API for course completion/engagement data. The only source is
a manual Excel export: **Analytics → Product Progress → Export Excel**. This
document describes how the export is automated into
`bronze.kajabi_product_progress`, and the one manual step that automation
can't remove: keeping the Kajabi login session alive.

## How it works

1. A daily GitHub Actions workflow (`.github/workflows/kajabi-product-progress-sync.yml`)
   runs `scripts/kajabi-export.ts`, which uses Playwright to open Kajabi's
   admin, download the Product Progress export, and save it as `.xlsx`.
2. It then runs `scripts/upload-kajabi-product-progress.ts`, which POSTs that
   file to `/api/import/kajabi-product-progress` on the deployed app.
3. That route parses the export and appends a snapshot into
   `bronze.kajabi_product_progress` (see `CLAUDE.md`'s Bronze layer
   conventions — this is an append-only snapshot table, not upsert-by-ID,
   since Kajabi's export has no stable row ID).
4. The admin member detail page (`/admin/members/[id]`) reads the latest
   snapshot per product and displays it as a "Course Progress" card.

## Why session state instead of a login step

Kajabi's admin account has 2FA enabled, so Playwright cannot automate a
plain email/password login. Instead, the workflow reuses a saved browser
session (Playwright `storageState` — the cookies/local storage from an
already-authenticated session) that's captured by hand and stored as a
GitHub Actions secret.

**How long that session lasts is not documented anywhere by Kajabi**, and
there's no live account access available to measure it directly. What is
knowable: when capturing the session, enable "stay signed in" / "remember
me" on Kajabi's login form if offered — that typically produces a
materially longer-lived cookie than a bare session. Kajabi does not expose
any setting to configure session duration, so "capture with remember-me,
let the Slack alert below catch expiry" is the practical ceiling here, not
a gap in this implementation. The first few weeks of daily runs will
empirically establish the real lifetime — note how many days it ran before
first failing, so future refreshes can be timed proactively instead of
reactively.

## Capturing / refreshing the session

1. Locally, run a small Playwright script headed so you can complete 2FA by
   hand:

   ```ts
   import { chromium } from "playwright";

   const browser = await chromium.launch({ headless: false });
   const context = await browser.newContext();
   const page = await context.newPage();
   await page.goto("https://app.kajabi.com/login");
   // Log in manually in the opened browser window, including 2FA and
   // checking "stay signed in" if offered. Then, back in the terminal:
   await context.storageState({ path: "kajabi-session.json" });
   await browser.close();
   ```

   (Run with `npx tsx` after pasting into a scratch `.ts` file, or adapt
   `scripts/kajabi-export.ts` temporarily with `HEADLESS=false` and no
   existing session file.)

2. Base64-encode the resulting file and set it as the `KAJABI_SESSION_STATE`
   GitHub Actions secret:

   ```bash
   base64 -i kajabi-session.json | pbcopy   # macOS
   # paste into the GitHub repo secret: Settings -> Secrets and variables -> Actions
   ```

3. Delete the local `kajabi-session.json` once it's stored as a secret —
   don't commit it.

4. When the daily workflow starts failing with "Kajabi session expired" (or
   the Slack alert fires — see below), repeat steps 1–2.

## Required secrets (GitHub Actions)

| Secret | Purpose |
|---|---|
| `KAJABI_SESSION_STATE` | Base64-encoded Playwright `storageState` JSON — the saved Kajabi login session |
| `SUPABASE_SERVICE_ROLE_KEY` | Authenticates the upload step against `/api/import/kajabi-product-progress` (same key used elsewhere for server-to-server calls — see `docs/SECRETS.md`) |
| `APP_URL` | Base URL of the deployed app the upload step POSTs to |
| `SLACK_BOT_TOKEN` | Posts the failure alert (already used elsewhere in this repo) |
| `SLACK_ALERT_CHANNEL_ID` | Channel the failure alert posts to |

## Manual / on-demand runs

Trigger the workflow manually from the Actions tab (or `gh workflow run
kajabi-product-progress-sync.yml`) — it has a `workflow_dispatch` trigger for
exactly this.

## Failure alerts

If any step fails, the workflow posts to Slack naming the likely cause
(session expiry) and linking the failed run. GitHub Actions also emails
failed-scheduled-run notifications by default, but the Slack ping is the
one that's actually meant to get noticed quickly — a silently failing daily
job could otherwise go unnoticed for weeks, which was the whole reason this
was automated in the first place.

## Scheduling mechanisms in this repo

See `docs/CRONJOBS.md` for the full inventory. In short: **Vercel Cron**
(`vercel.json`) runs jobs entirely inside a Vercel serverless function —
use it for anything HTTP-callable and short enough for Hobby tier's
duration limits. **GitHub Actions cron** (`.github/workflows/`) is for jobs
needing a real browser (Playwright) or a longer runtime than Vercel allows
— this Kajabi sync is the first job that needed it.
