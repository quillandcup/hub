# Daily Reconciliation Cron Jobs

This directory contains automated reconciliation endpoints that run daily via Vercel Cron Jobs. They act as a safety net to catch any data that might have been missed by webhooks or manual imports.

## Architecture

The reconciliation system follows the Bronze-Silver data pipeline pattern:

1. **Fetch** - Pull ALL relevant data from external APIs (last 90 days)
2. **UPSERT to Bronze** - Idempotently update Bronze layer tables
3. **Trigger Silver Processing** - Call existing processing routes to update Silver layer

This ensures that even if webhooks fail or are missed, the system self-heals daily.

## Endpoints

### `/api/reconcile/calendar` (2:00am daily)

Reconciles calendar events from Google Calendar.

**What it does:**
- Fetches last 90 days of events from Google Calendar API
- UPSERTs to `bronze.calendar_events` table
- Triggers `/api/process/calendar` to update `prickles` table

**Schedule:** Daily at 2:00am UTC
**Timeout:** 300 seconds (5 minutes)

### `/api/reconcile/zoom` (2:30am daily)

Reconciles Zoom meeting attendance data.

**What it does:**
- Fetches last 90 days of meetings from Zoom API
- For each meeting, fetches participant data
- UPSERTs to `bronze.zoom_meetings` and `bronze.zoom_attendees` tables
- Triggers `/api/process/attendance` to update `attendance` and PUP prickles

**Schedule:** Daily at 2:30am UTC (30 min after calendar)
**Timeout:** 300 seconds (5 minutes)

### `/api/reconcile/members` (3:00am daily)

Reconciles member data from Kajabi imports.

**What it does:**
- Checks for latest `bronze.kajabi_members` snapshot
- Triggers `/api/process/members` to update `members` table
- Does NOT fetch from external API (Kajabi imports are CSV-based)

**Schedule:** Daily at 3:00am UTC (30 min after Zoom)
**Timeout:** 300 seconds (5 minutes)

## Authentication

Reconciliation endpoints support two authentication methods:

1. **Vercel Cron Secret** (production)
   - Vercel sends `Authorization: Bearer <CRON_SECRET>` header
   - Configure `CRON_SECRET` environment variable in Vercel dashboard
   - Generate with: `openssl rand -hex 32`

2. **Authenticated User** (manual testing)
   - Regular Supabase authentication
   - Allows admins to trigger reconciliation manually via Postman/curl

## Manual Testing

You can trigger reconciliation jobs manually for testing:

```bash
# Ensure you're authenticated (get JWT token from browser)
TOKEN="your-supabase-jwt-token"

# Calendar reconciliation
curl -X POST https://admin.quillandcup.com/api/reconcile/calendar \
  -H "Authorization: Bearer $TOKEN"

# Zoom reconciliation
curl -X POST https://admin.quillandcup.com/api/reconcile/zoom \
  -H "Authorization: Bearer $TOKEN"

# Members reconciliation
curl -X POST https://admin.quillandcup.com/api/reconcile/members \
  -H "Authorization: Bearer $TOKEN"
```

## Monitoring

Check reconciliation job status in Vercel:

1. Go to Vercel dashboard → Project → Cron
2. View execution history and logs
3. Set up notifications for failures (recommended)

## Configuration

The cron schedule is defined in `/vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/reconcile/calendar",
      "schedule": "0 2 * * *"
    },
    {
      "path": "/api/reconcile/zoom",
      "schedule": "30 2 * * *"
    },
    {
      "path": "/api/reconcile/members",
      "schedule": "0 3 * * *"
    }
  ]
}
```

**Cron syntax:** `minute hour day month dayOfWeek`
- `0 2 * * *` = 2:00am every day
- `30 2 * * *` = 2:30am every day
- `0 3 * * *` = 3:00am every day

## Why 90 Days?

The 90-day lookback window provides:
- **Safety margin** - Catches events from up to 3 months ago
- **Historical accuracy** - Ensures recent past is always synchronized
- **Performance** - Reasonable API response times (1000-2000 events typical)
- **Cost efficiency** - Balances completeness vs API quota usage

For older data, use manual import tools in the admin dashboard.

## Failure Handling

If a reconciliation job fails:

1. **Logs** - Check Vercel function logs for error details
2. **Retry** - Cron jobs retry automatically (Vercel default behavior)
3. **Manual trigger** - Use curl/Postman to trigger manually if needed
4. **Alert** - Consider setting up Slack/email notifications for failures

## Environment Variables

Required environment variables:

- `CRON_SECRET` - Authentication secret for Vercel cron jobs (production)
- `GOOGLE_CALENDAR_ID` - Google Calendar to sync
- `GOOGLE_SERVICE_ACCOUNT_KEY` - Google API credentials
- `ZOOM_ACCOUNT_ID` - Zoom API credentials
- `ZOOM_CLIENT_ID` - Zoom API credentials
- `ZOOM_CLIENT_SECRET` - Zoom API credentials
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase public API key

See `docs/DEPLOYMENT_SETUP.md` for setup instructions.

## Related Documentation

- [Architecture Foundation](../../../docs/architecture-foundation.md) - Overall data pipeline design
- [Deployment Setup](../../../docs/DEPLOYMENT_SETUP.md) - Environment configuration
- [Processing Routes](../process/README.md) - Silver layer processing logic
