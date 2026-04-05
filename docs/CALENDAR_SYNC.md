# Google Calendar Sync

Automatically sync prickles from Google Calendar.

## Setup

### 1. Get Google OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select existing)
3. Enable Google Calendar API
4. Create OAuth 2.0 credentials
5. Add authorized redirect URI: `http://localhost:3000/api/google-calendar/callback` (dev) or your production URL

### 2. Configure Environment Variables

Add to `.env.local`:

```bash
# Google Calendar API
GOOGLE_CLIENT_ID=your-client-id-here
GOOGLE_CLIENT_SECRET=your-client-secret-here
GOOGLE_REDIRECT_URI=http://localhost:3000/api/google-calendar/callback

# Quill & Cup Prickle Calendar ID
GOOGLE_CALENDAR_ID=dd6745e544f1a8a93f0f7fd6d3fc633ab9c864e1090603a793c69d101f695e6e@group.calendar.google.com

# Get this from OAuth flow (see step 3)
GOOGLE_REFRESH_TOKEN=your-refresh-token-here
```

### 3. Get Refresh Token

1. Go to `/dashboard/import`
2. Click "Authenticate with Google"
3. Sign in and grant permissions
4. Copy the `refresh_token` from the redirect URL
5. Add to `.env.local` as `GOOGLE_REFRESH_TOKEN`

## Manual Sync

### Via UI

1. Go to `/dashboard/import`
2. Scroll to "Import Prickles from Google Calendar"
3. Click "Sync Now" (uses configured calendar, syncs 30 days back + 90 days forward)

### Via API

```bash
curl -X POST http://localhost:3000/api/sync/calendar \
  -H "Content-Type: application/json" \
  -d '{"daysBack": 30, "daysForward": 90}'
```

## Automatic Sync (Production)

### Option 1: Vercel Cron Jobs

Add to `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/sync/calendar",
      "schedule": "0 */6 * * *"
    }
  ]
}
```

This syncs every 6 hours.

### Option 2: External Cron

Use a service like [cron-job.org](https://cron-job.org) to call:

```
POST https://your-domain.com/api/sync/calendar
```

### Option 3: GitHub Actions

Create `.github/workflows/sync-calendar.yml`:

```yaml
name: Sync Calendar
on:
  schedule:
    - cron: '0 */6 * * *'  # Every 6 hours
  workflow_dispatch:  # Manual trigger

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - name: Sync Calendar
        run: |
          curl -X POST https://your-domain.com/api/sync/calendar \
            -H "Content-Type: application/json" \
            -d '{"daysBack": 30, "daysForward": 90}'
```

## How It Works

1. **Idempotent**: Safe to run multiple times
2. **Upserts**: Updates existing prickles if event details changed
3. **Deduplication**: Uses `google_calendar_event_id` to prevent duplicates
4. **Date Range**: Syncs past 30 days + future 90 days (configurable)
5. **Filters**: Skips all-day events (only syncs timed events)

## Sync Results

- **Imported**: New events added to database
- **Updated**: Existing events with changed details (title, time, host)
- **Skipped**: Unchanged events or invalid events (all-day, etc.)
