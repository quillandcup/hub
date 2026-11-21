# Google Calendar: setup and sync

> **Status:** living. **Last reviewed:** 2026-11-21. Review: yearly. Kept up to date with the code; if it is wrong, fix it.

## Why Service Account?

- **No OAuth flow** - Just a JSON key file
- **No token expiry** - Credentials don't expire
- **Perfect for automation** - Server-to-server access
- **Simple setup** - Share calendar with service account email

## Step-by-Step Setup

### 1. Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click project dropdown → "NEW PROJECT"
3. Name: "Quill & Cup" 
4. Click "CREATE"

### 2. Enable Google Calendar API

1. Select your project
2. Left sidebar → "APIs & Services" → "Library"
3. Search "Google Calendar API"
4. Click it → "ENABLE"

### 3. Create Service Account

1. Left sidebar → "APIs & Services" → "Credentials"
2. Click "CREATE CREDENTIALS" → "Service account"
3. Service account details:
   - **Name**: quill-cup-calendar-sync
   - **ID**: (auto-filled)
   - **Description**: Read access to Quill & Cup prickle calendar
4. Click "CREATE AND CONTINUE"
5. Skip "Grant this service account access to project" (click CONTINUE)
6. Skip "Grant users access" (click DONE)

### 4. Create Service Account Key

1. Click on the service account you just created
2. Go to "KEYS" tab
3. Click "ADD KEY" → "Create new key"
4. Select "JSON"
5. Click "CREATE"
6. **IMPORTANT**: Save this JSON file securely - you can't download it again!

### 5. Share Calendar with Service Account

1. Open the JSON key file
2. Copy the `client_email` value (looks like: `quill-cup-calendar-sync@project-id.iam.gserviceaccount.com`)
3. Go to [Google Calendar](https://calendar.google.com/)
4. Find "Quill & Cup Prickles" calendar in the left sidebar
5. Click the three dots → "Settings and sharing"
6. Scroll to "Share with specific people"
7. Click "Add people"
8. Paste the service account email
9. Permission: "See all event details"
10. Click "Send"

### 6. Add to .env.local

1. Open the downloaded JSON key file
2. Copy the entire JSON content (it's one long line)
3. Add to `.env.local`:

```bash
# Google Calendar API (Service Account)
GOOGLE_SERVICE_ACCOUNT_KEY={"type":"service_account","project_id":"...paste entire JSON here..."}

# The prickle calendar's ID (Google Calendar settings, "Integrate calendar")
GOOGLE_CALENDAR_ID=your_calendar_id@group.calendar.google.com
```

**Note**: The JSON should be on ONE line (no newlines). If your editor auto-formats it, make sure to remove newlines.

### 7. Test It

1. Restart your dev server: `pnpm dev`
2. Sign in as an admin and go to `http://localhost:3000/admin/data/import`
3. Find "Import Prickles from Google Calendar" and run the import (`CalendarImportForm`; the dates default to 30 days back and 90 forward)
4. The result reports how many events were imported

## Production Setup

For Vercel/production:

1. Put `GOOGLE_SERVICE_ACCOUNT_KEY`, `GOOGLE_CALENDAR_ID` and `GOOGLE_CALENDAR_WEBHOOK_TOKEN` in `.env.shared` (or the per-environment files), then `pnpm env:sync` (`docs/infrastructure/ENV_MANAGEMENT.md`)
2. Deploy: the values are read at build and run time of the deployment

**Security Note**: The service account key is sensitive! Never commit it to git; the `.env*` files that hold it are gitignored.

## How the sync works

The service account has read-only access (`calendar.readonly`, `src/lib/google-calendar/client.ts`). A sync writes the calendar's timed events to Bronze unmodified (`bronze.calendar_events`, upserted by Google's event id, so it is idempotent); a separate processing step (`/api/process/calendar`) turns them into prickles, so the schedule can always be rebuilt from source. All-day items have no start and end time and are skipped (`isTimedEvent`, `src/lib/google-calendar/events.ts`).

Three ways a sync runs:

1. **Push notifications (seconds after an edit).** Google calls `/api/webhooks/calendar`, which runs an incremental sync (only what changed since the last one, including cancellations) in the background. Setup and checks: `docs/infrastructure/WEBHOOK_SETUP.md`, "Google Calendar Webhooks".
2. **Nightly reconcile (the guaranteed path).** The Vercel cron in `vercel.json` calls `/api/reconcile/calendar` at 2:00 AM: it opens or renews the push channel (production only), runs a full import of 90 days back and 90 forward, removes events deleted outside that window, and reprocesses. It pings a Checkly heartbeat on success (`src/lib/cron-heartbeats.ts`).
3. **By hand (admin).** `/admin/data/import`, "Import Prickles from Google Calendar" (`POST /api/import/calendar`, admin only). Use it to import a wider range than the 90-day window, which older items need before they can match a prickle type (`docs/product/CALENDAR_EVENTS.md`, "How a calendar title finds its prickle type").

The import accepts either `fromDate` and `toDate`, or `daysBack` (default 30) and `daysForward` (default 90). Re-running it is safe: unchanged events are not rewritten. How an item becomes a prickle or an event, and what an admin can edit on top, is in `docs/product/CALENDAR_EVENTS.md`.

## Troubleshooting

**"GOOGLE_SERVICE_ACCOUNT_KEY not configured"**
- Make sure the env var is set and is valid JSON
- Check for newlines - should be ONE line
- Restart dev server after changing .env.local

**"Calendar not found" or "403 Forbidden"**
- Make sure you shared the calendar with the service account email
- Permission must be "See all event details" (not just "See only free/busy")
- Wait a minute after sharing - can take time to propagate

**"No events found"**
- Check the date range
- Make sure events have specific times (not all-day events)
- Verify the calendar ID is correct
