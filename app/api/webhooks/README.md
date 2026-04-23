# Webhook Handlers

Real-time webhook handlers for Bronze UPSERT + Silver processing.

## Overview

When external systems send events, we UPSERT to Bronze layer and immediately trigger Silver processing for real-time updates.

## Endpoints

- `/api/webhooks/calendar` - Google Calendar push notifications
- `/api/webhooks/zoom` - Zoom meeting events
- `/api/webhooks/slack` - Slack Events API

## Architecture

Each webhook handler follows this pattern:

```typescript
export async function POST(request: NextRequest) {
  // 1. Verify webhook signature (TODO: implement)
  // 2. Parse webhook payload
  // 3. UPSERT to Bronze layer (idempotent)
  // 4. Trigger downstream Silver processing (fire-and-forget)
  // 5. Return 200 OK immediately
}
```

## Key Principles

### Fast Response
Webhooks must respond within seconds to avoid timeouts and retries:
- `maxDuration = 60` (1 minute max)
- Return 200 OK before processing completes
- Use fire-and-forget pattern for Silver processing

### Idempotency
Bronze UPSERT ensures duplicate webhooks are safe:
- Google Calendar: UPSERT by `google_event_id`
- Zoom: UPSERT by `meeting_uuid` and `(meeting_uuid, name, join_time)`
- Slack: UPSERT by `(channel_id, message_ts)` or `(channel_id, message_ts, user_id, reaction)`

### Authentication
Webhooks use service role key (no user session):
- Import routes support both cookie-based and service role auth
- Processing routes support service role auth via Authorization header

## TODO: Security Improvements

### Signature Verification

All webhook handlers have signature verification marked as TODO. This should be implemented to ensure webhooks are from the claimed source.

#### Google Calendar
```typescript
// Verify X-Goog-Channel-Token header matches token set when creating watch
const channelToken = request.headers.get("x-goog-channel-token");
const expectedToken = process.env.GOOGLE_CALENDAR_WEBHOOK_TOKEN;

if (channelToken !== expectedToken) {
  return NextResponse.json({ error: "Invalid token" }, { status: 401 });
}
```

#### Zoom
```typescript
const signature = request.headers.get("x-zm-signature");
const timestamp = request.headers.get("x-zm-request-timestamp");
const secretToken = process.env.ZOOM_WEBHOOK_SECRET_TOKEN;

const message = `v0:${timestamp}:${body}`;
const hashForVerify = createHmac('sha256', secretToken)
  .update(message)
  .digest('hex');
const expectedSignature = `v0=${hashForVerify}`;

if (signature !== expectedSignature) {
  return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
}
```

#### Slack
```typescript
const signature = request.headers.get("x-slack-signature");
const timestamp = request.headers.get("x-slack-request-timestamp");
const signingSecret = process.env.SLACK_SIGNING_SECRET;

// Verify timestamp is not too old (prevent replay attacks)
const requestTimestamp = parseInt(timestamp || '0');
const now = Math.floor(Date.now() / 1000);
if (Math.abs(now - requestTimestamp) > 60 * 5) {
  return NextResponse.json({ error: "Request too old" }, { status: 401 });
}

const sigBasestring = `v0:${timestamp}:${body}`;
const mySignature = 'v0=' + createHmac('sha256', signingSecret)
  .update(sigBasestring)
  .digest('hex');

if (signature !== mySignature) {
  return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
}
```

## Current Limitations

1. **No signature verification** - Webhooks trust all incoming requests
2. **No webhook event logging** - Debugging relies on console logs
3. **No retry handling** - Failed processing is not automatically retried
4. **No rate limiting** - Webhooks can be called unlimited times

## Data Flow

```
External System → Webhook Handler → Bronze UPSERT → Silver Processing
                     ↓ (immediate)
                  200 OK Response
```

Example for Calendar:
1. User updates event in Google Calendar
2. Google sends webhook to `/api/webhooks/calendar`
3. Handler triggers calendar sync (fire-and-forget)
4. Handler returns 200 OK immediately
5. Sync fetches latest data from Google API
6. Sync UPSERTS to `bronze.calendar_events`
7. Sync triggers `/api/process/calendar`
8. Processing DELETE+INSERT to `prickles`
9. Dashboard shows updated data

## Testing

See `/docs/WEBHOOK_TESTING.md` for manual testing commands.

## Setup

See `/docs/WEBHOOK_SETUP.md` for production setup guide.

## Next Steps

- [ ] Implement signature verification for all webhooks
- [ ] Add webhook event logging to database
- [ ] Set up monitoring/alerting for webhook failures
- [ ] Add integration tests for webhook handlers
- [ ] Document webhook retry behavior
- [ ] Add rate limiting to prevent abuse
- [ ] Consider using Vercel Edge Functions for even faster response times
