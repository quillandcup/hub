# Webhook Testing Guide

Quick reference for testing webhook handlers manually.

## Test Webhook Endpoints

### Calendar Webhook

```bash
# Test GET (verification)
curl http://localhost:3000/api/webhooks/calendar

# Test POST (sync notification)
curl -X POST http://localhost:3000/api/webhooks/calendar \
  -H "Content-Type: application/json" \
  -H "X-Goog-Channel-ID: test-channel" \
  -H "X-Goog-Resource-State: sync" \
  -d '{}'

# Test POST (event change)
curl -X POST http://localhost:3000/api/webhooks/calendar \
  -H "Content-Type: application/json" \
  -H "X-Goog-Channel-ID: test-channel" \
  -H "X-Goog-Resource-State: exists" \
  -d '{}'
```

Expected responses:
- GET: `{"message":"Calendar webhook endpoint ready","verified":true}`
- POST (sync): `{"received":true}`
- POST (exists): `{"received":true,"resourceState":"exists","channelId":"test-channel","triggered":"calendar_sync"}`

### Zoom Webhook

```bash
# Test GET (verification)
curl http://localhost:3000/api/webhooks/zoom

# Test POST (endpoint validation)
curl -X POST http://localhost:3000/api/webhooks/zoom \
  -H "Content-Type: application/json" \
  -d '{
    "event": "endpoint.url_validation",
    "payload": {
      "plainToken": "test_plain_token"
    }
  }'

# Test POST (meeting ended)
curl -X POST http://localhost:3000/api/webhooks/zoom \
  -H "Content-Type: application/json" \
  -d '{
    "event": "meeting.ended",
    "payload": {
      "object": {
        "id": 123456789,
        "uuid": "test-uuid",
        "topic": "Test Meeting",
        "start_time": "2026-04-23T10:00:00Z",
        "end_time": "2026-04-23T11:00:00Z"
      }
    }
  }'
```

Expected responses:
- GET: `{"message":"Zoom webhook endpoint ready","verified":true}`
- POST (validation): `{"plainToken":"test_plain_token","encryptedToken":"..."}`
- POST (meeting.ended): `{"received":true,"event":"meeting.ended","processed":true}`

### Slack Webhook

```bash
# Test GET (verification)
curl http://localhost:3000/api/webhooks/slack

# Test POST (URL verification)
curl -X POST http://localhost:3000/api/webhooks/slack \
  -H "Content-Type: application/json" \
  -d '{
    "type": "url_verification",
    "challenge": "test_challenge_string"
  }'

# Test POST (message event)
curl -X POST http://localhost:3000/api/webhooks/slack \
  -H "Content-Type: application/json" \
  -d '{
    "type": "event_callback",
    "event": {
      "type": "message",
      "channel": "C12345678",
      "user": "U12345678",
      "text": "Test message",
      "ts": "1678901234.567890"
    }
  }'

# Test POST (reaction added)
curl -X POST http://localhost:3000/api/webhooks/slack \
  -H "Content-Type: application/json" \
  -d '{
    "type": "event_callback",
    "event": {
      "type": "reaction_added",
      "user": "U12345678",
      "reaction": "thumbsup",
      "item": {
        "type": "message",
        "channel": "C12345678",
        "ts": "1678901234.567890"
      },
      "event_ts": "1678901235.000000"
    }
  }'
```

Expected responses:
- GET: `{"message":"Slack webhook endpoint ready","verified":true}`
- POST (url_verification): `{"challenge":"test_challenge_string"}`
- POST (message): `{"received":true,"type":"event_callback","event":"message"}`
- POST (reaction): `{"received":true,"type":"event_callback","event":"reaction_added"}`

## Integration Testing

### Full Flow Test (Calendar)

1. Start dev server: `npm run dev`
2. Send webhook event (see above)
3. Check console logs for:
   - "Calendar webhook received"
   - "Calendar sync triggered successfully"
4. Verify database:
   ```sql
   SELECT COUNT(*) FROM bronze.calendar_events WHERE imported_at > NOW() - INTERVAL '1 minute';
   ```

### Full Flow Test (Zoom)

1. Start dev server: `npm run dev`
2. Send meeting.ended webhook (see above)
3. Wait 10 seconds (delay for Zoom data finalization)
4. Check console logs for:
   - "Zoom webhook received"
   - "Processing Zoom event: meeting.ended"
   - "Zoom import triggered successfully"
5. Verify database:
   ```sql
   SELECT COUNT(*) FROM bronze.zoom_meetings WHERE imported_at > NOW() - INTERVAL '1 minute';
   ```

### Full Flow Test (Slack)

1. Start dev server: `npm run dev`
2. Send message event webhook (see above)
3. Check console logs for:
   - "Slack webhook received"
   - "Processing Slack event: message"
   - "Slack message upserted"
   - "Slack processing triggered successfully"
4. Verify database:
   ```sql
   SELECT COUNT(*) FROM bronze.slack_messages WHERE imported_at > NOW() - INTERVAL '1 minute';
   ```

## Automated Testing

TODO: Create integration tests using Vitest or Jest:

```typescript
// tests/webhooks/calendar.test.ts
describe('Calendar Webhook', () => {
  it('should respond 200 OK to sync notification', async () => {
    const response = await fetch('http://localhost:3000/api/webhooks/calendar', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Channel-ID': 'test-channel',
        'X-Goog-Resource-State': 'sync',
      },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.received).toBe(true);
  });

  it('should trigger calendar sync on event change', async () => {
    // Test implementation
  });
});
```

## Monitoring Webhooks

### Check Recent Webhook Calls

```bash
# Vercel CLI (production)
vercel logs --limit 100 | grep 'webhook received'

# Local development
tail -f .next/trace | grep 'webhook'
```

### Database Queries

```sql
-- Check recent Bronze imports (triggered by webhooks)
SELECT 
  'calendar' as source,
  COUNT(*) as recent_imports,
  MAX(imported_at) as last_import
FROM bronze.calendar_events
WHERE imported_at > NOW() - INTERVAL '1 hour'

UNION ALL

SELECT 
  'zoom' as source,
  COUNT(*) as recent_imports,
  MAX(imported_at) as last_import
FROM bronze.zoom_meetings
WHERE imported_at > NOW() - INTERVAL '1 hour'

UNION ALL

SELECT 
  'slack' as source,
  COUNT(*) as recent_imports,
  MAX(imported_at) as last_import
FROM bronze.slack_messages
WHERE imported_at > NOW() - INTERVAL '1 hour';
```

## Common Issues

### "Unauthorized" error
- Check SUPABASE_SERVICE_ROLE_KEY is set in environment
- Verify webhook uses service role client (not cookie-based auth)

### Webhook received but no processing
- Check console logs for "triggered successfully" message
- Verify processing route exists and is accessible
- Check Vercel function logs for internal fetch errors

### Database not updated
- Check Bronze UPSERT succeeded in logs
- Verify schema prefix (`.schema('bronze')`) is correct
- Check for database constraint violations

### Processing route fails
- Check date range is valid
- Verify service role key is authorized
- Check processing route logs for specific errors
