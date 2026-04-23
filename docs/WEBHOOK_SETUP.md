# Webhook Setup Guide

This guide explains how to configure and test real-time webhook handlers for Bronze layer updates.

## Overview

The admin portal supports real-time webhooks from external systems:

- **Google Calendar** - Push notifications when calendar events change
- **Zoom** - Events when meetings start/end or participants join/leave
- **Slack** - Events when messages are posted or reactions are added

Each webhook handler:
1. Verifies the webhook source (signature verification - TODO)
2. UPSERTS to Bronze layer (idempotent)
3. Triggers downstream Silver processing asynchronously
4. Returns 200 OK immediately (webhooks expect fast response)

## Security - Environment Variables

**IMPORTANT:** Webhook signature secrets are **production secrets** and must be stored in Vercel environment variables, **never committed to the repository**.

### Required Vercel Environment Variables

Set these in Vercel dashboard → Settings → Environment Variables → Production:

- `ZOOM_WEBHOOK_SECRET_TOKEN` - From Zoom app webhook settings
- `SLACK_SIGNING_SECRET` - From Slack app basic information page
- `GOOGLE_CALENDAR_WEBHOOK_TOKEN` - Generate with `openssl rand -hex 32`

**DO NOT** add these to `.env.local` or commit them to git. They are production-only secrets.

## Webhook Endpoints

All webhooks are deployed at:

```
https://your-domain.vercel.app/api/webhooks/{service}
```

Example endpoints:
- Production: `https://admin.quillandcup.com/api/webhooks/calendar`
- Preview: `https://admin-git-main-yourorg.vercel.app/api/webhooks/zoom`
- Development: `http://localhost:3000/api/webhooks/slack`

## Google Calendar Webhooks

### Setup

1. **Enable Google Calendar API** in Google Cloud Console
2. **Create a watch channel** using the Google Calendar API:

```bash
curl -X POST \
  'https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events/watch' \
  -H 'Authorization: Bearer {access_token}' \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "quill-cup-admin-portal",
    "type": "web_hook",
    "address": "https://admin.quillandcup.com/api/webhooks/calendar",
    "token": "{your_secret_token}",
    "expiration": "{unix_timestamp_ms}"
  }'
```

3. **Set webhook token** in environment variables:
   ```bash
   GOOGLE_CALENDAR_WEBHOOK_TOKEN=your_secret_token
   ```

### Testing

Test the endpoint verification:

```bash
curl https://admin.quillandcup.com/api/webhooks/calendar
```

Expected response:
```json
{
  "message": "Calendar webhook endpoint ready",
  "verified": true
}
```

### Webhook Events

Google Calendar sends notifications for:
- Event created/updated
- Event deleted
- Initial sync when watch is established

See: [Google Calendar Push Notifications](https://developers.google.com/calendar/api/guides/push)

## Zoom Webhooks

### Setup

1. **Create a Zoom App** at [Zoom Marketplace](https://marketplace.zoom.us/develop/create)
2. **Enable Event Subscriptions** in app settings
3. **Add webhook URL**: `https://admin.quillandcup.com/api/webhooks/zoom`
4. **Subscribe to events**:
   - Meeting Started
   - Meeting Ended
   - Participant Joined Meeting
   - Participant Left Meeting

5. **Set webhook secret** in environment variables:
   ```bash
   ZOOM_WEBHOOK_SECRET_TOKEN=your_secret_token
   ```

### Testing

Test the endpoint verification:

```bash
curl https://admin.quillandcup.com/api/webhooks/zoom
```

Expected response:
```json
{
  "message": "Zoom webhook endpoint ready",
  "verified": true
}
```

### Webhook Events

Zoom sends notifications for:
- `meeting.started` - Meeting begins
- `meeting.ended` - Meeting ends (triggers attendance import)
- `meeting.participant_joined` - Participant joins
- `meeting.participant_left` - Participant leaves (triggers attendance import)

See: [Zoom Webhook Events](https://developers.zoom.us/docs/api/rest/webhook-reference/)

## Slack Webhooks

### Setup

1. **Create a Slack App** at [Slack API](https://api.slack.com/apps)
2. **Enable Event Subscriptions** in app settings
3. **Set Request URL**: `https://admin.quillandcup.com/api/webhooks/slack`
4. **Subscribe to bot events**:
   - `message.channels` - Messages in public channels
   - `message.groups` - Messages in private channels
   - `reaction_added` - Emoji reactions added
   - `reaction_removed` - Emoji reactions removed

5. **Set signing secret** in environment variables:
   ```bash
   SLACK_SIGNING_SECRET=your_signing_secret
   ```

### Testing

Test the endpoint verification:

```bash
curl https://admin.quillandcup.com/api/webhooks/slack
```

Expected response:
```json
{
  "message": "Slack webhook endpoint ready",
  "verified": true
}
```

### Webhook Events

Slack sends notifications for:
- `message` - New message posted
- `reaction_added` - Emoji reaction added to message
- `reaction_removed` - Emoji reaction removed from message

See: [Slack Events API](https://api.slack.com/apis/connections/events-api)

## Local Testing with ngrok

To test webhooks locally during development:

1. **Install ngrok**: `brew install ngrok`
2. **Start ngrok tunnel**: `ngrok http 3000`
3. **Use ngrok URL** for webhook setup: `https://abc123.ngrok.io/api/webhooks/calendar`

Example:
```bash
# Terminal 1: Start dev server
npm run dev

# Terminal 2: Start ngrok
ngrok http 3000

# Terminal 3: Test webhook
curl https://abc123.ngrok.io/api/webhooks/calendar
```

## Security

### Signature Verification (TODO)

Currently, webhook handlers log signature headers but don't verify them. This is marked as TODO for implementation.

**Google Calendar**: Verify `X-Goog-Channel-Token` header matches the token set when creating the watch.

**Zoom**: Verify HMAC-SHA256 signature in `X-Zm-Signature` header:
```typescript
const message = `v0:${timestamp}:${body}`;
const hashForVerify = createHmac('sha256', secretToken)
  .update(message)
  .digest('hex');
const expectedSignature = `v0=${hashForVerify}`;
```

**Slack**: Verify HMAC-SHA256 signature in `X-Slack-Signature` header:
```typescript
const sigBasestring = `v0:${timestamp}:${body}`;
const mySignature = 'v0=' + createHmac('sha256', signingSecret)
  .update(sigBasestring)
  .digest('hex');
```

### Environment Variables

Set webhook secrets in Vercel dashboard (Settings → Environment Variables):

```
GOOGLE_CALENDAR_WEBHOOK_TOKEN=...
ZOOM_WEBHOOK_SECRET_TOKEN=...
SLACK_SIGNING_SECRET=...
SUPABASE_SERVICE_ROLE_KEY=...  # Required for internal processing
```

## Monitoring

### Logs

View webhook logs in Vercel dashboard:
1. Go to Deployments → Select deployment
2. Click "View Function Logs"
3. Filter by `/api/webhooks/*`

### Debugging

Each webhook handler logs:
- Webhook event type
- Signature presence (for verification debugging)
- Processing status
- Error messages (if any)

Example log output:
```
Slack webhook received: {
  type: 'event_callback',
  event: 'message',
  signature: 'present',
  timestamp: '1678901234'
}
Slack message upserted: 1678901234.567890
Slack processing triggered successfully
```

## Troubleshooting

### Webhook not receiving events

1. **Check endpoint is accessible** (GET request should return 200 OK)
2. **Verify webhook URL** in external service settings
3. **Check Vercel logs** for incoming requests
4. **Test with ngrok** to rule out deployment issues

### Signature verification fails

1. **Check environment variables** are set correctly
2. **Verify secret token** matches external service settings
3. **Enable signature verification** (currently TODO)

### Processing not triggered

1. **Check service role key** is set in environment variables
2. **Verify processing route** exists and is accessible
3. **Check Vercel logs** for internal fetch errors

### Webhook timeouts

1. **Ensure response is immediate** (200 OK within seconds)
2. **Don't await processing** - use fire-and-forget pattern
3. **Check maxDuration** is set to 60 seconds (not too high)

## Data Flow

```
External System → Webhook Handler → Bronze UPSERT → Silver Processing
                     ↓ (immediate)
                  200 OK Response
```

### Example: Calendar Event Update

1. User updates calendar event in Google Calendar
2. Google sends webhook to `/api/webhooks/calendar`
3. Handler triggers calendar sync (fire-and-forget)
4. Handler returns 200 OK immediately
5. Sync fetches latest calendar data from Google API
6. Sync UPSERTS to `bronze.calendar_events` (idempotent)
7. Sync triggers `/api/process/calendar` for affected date range
8. Processing DELETE+INSERT to `prickles` (Silver layer)
9. Dashboard shows updated data

## Next Steps

- [ ] Implement signature verification for all webhooks
- [ ] Add webhook event logging to database for debugging
- [ ] Set up monitoring/alerting for webhook failures
- [ ] Document webhook retry behavior and handling
- [ ] Add integration tests for webhook handlers
