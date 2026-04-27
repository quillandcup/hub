# Webhook Testing Guide

## Overview

This project uses **MSW (Mock Service Worker)** for hermetic webhook testing with **signature verification** enabled for all webhooks.

## Test Results

```
Test Files: 3 passed
Tests: 23 passed | 4 skipped (27 total)

✅ Calendar: 8/8 passing (incl. token verification)
✅ Zoom: 9/9 passing (incl. HMAC signature verification)
✅ Slack: 6/10 passing + 4 skipped (incl. HMAC & timestamp verification)
```

## Security Implementation

### ✅ Implemented Signature Verification

All three webhooks now have signature verification enabled:

1. **Google Calendar** - Channel token verification
   - Validates `X-Goog-Channel-Token` header
   - Configure via `GOOGLE_CALENDAR_WEBHOOK_TOKEN` env var

2. **Zoom** - HMAC-SHA256 signature
   - Validates `X-Zm-Signature` header
   - Configure via `ZOOM_WEBHOOK_SECRET_TOKEN` env var

3. **Slack** - HMAC-SHA256 with timestamp validation
   - Validates `X-Slack-Signature` header
   - Rejects requests older than 5 minutes (replay attack prevention)
   - Configure via `SLACK_SIGNING_SECRET` env var

**Behavior when secrets are not configured:** Webhooks accept requests without verification (development mode).

## Test Coverage

### Calendar Webhook (`/api/webhooks/calendar`)

✅ **Passing Tests:**
- GET verification request
- Sync notification handling
- Event change triggers calendar sync
- Invalid payload rejection
- Error resilience (returns 200)
- Idempotency
- **Token verification** (valid vs invalid)
- Graceful degradation (no token configured)

### Zoom Webhook (`/api/webhooks/zoom`)

✅ **Passing Tests:**
- GET verification request
- Endpoint validation challenge
- Meeting ended triggers import
- Meeting events handling
- Error resilience
- Malformed JSON handling
- **HMAC signature verification** (valid vs invalid)
- Graceful degradation (no secret configured)

### Slack Webhook (`/api/webhooks/slack`)

✅ **Passing Tests:**
- GET verification request
- URL verification challenge
- Error resilience
- Malformed JSON handling
- **HMAC signature verification** (valid vs invalid)
- **Timestamp validation** (reject old requests)
- Graceful degradation (no secret configured)

⏭️ **Skipped Tests (require integration setup):**
- Bronze layer UPSERT verification
- Silver processing trigger verification
- Idempotency at database level

These tests are written but require integration test infrastructure (shared test database).

## Running Tests

```bash
# Run all webhook tests
npm test -- tests/api/webhooks/

# Run specific webhook test
npm test -- tests/api/webhooks/calendar.test.ts
npm test -- tests/api/webhooks/zoom.test.ts
npm test -- tests/api/webhooks/slack.test.ts
```

## Test Infrastructure

### Dependencies

```bash
npm install --save-dev msw@latest
```

### Configuration Files

- `tests/setup-msw.ts` - MSW server initialization
- `vitest.config.ts` - Includes MSW setup
- `tests/helpers/webhook-helpers.ts` - Fixture loading utilities

### Fixture Files

Located in `tests/fixtures/webhooks/`:

```
tests/fixtures/webhooks/
├── calendar/
│   ├── sync-notification.json
│   └── event-changed.json
├── zoom/
│   ├── endpoint-validation.json
│   └── meeting-ended.json
└── slack/
    ├── url-verification.json
    ├── message-posted.json
    └── reaction-added.json
```

## Production Webhook Setup

### Environment Variables (Vercel Project Settings)

```bash
# Required for signature verification
ZOOM_WEBHOOK_SECRET_TOKEN=<your-zoom-secret>
SLACK_SIGNING_SECRET=<your-slack-secret>
GOOGLE_CALENDAR_WEBHOOK_TOKEN=<your-calendar-token>

# Required for webhook functionality
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
VERCEL_URL=<auto-set-by-vercel>
```

### Webhook URL Configuration

Configure these URLs in external services:

1. **Google Calendar**
   - Console: https://console.cloud.google.com/apis/credentials
   - URL: `https://your-domain.vercel.app/api/webhooks/calendar`
   - Token: Set `X-Goog-Channel-Token` to match `GOOGLE_CALENDAR_WEBHOOK_TOKEN`

2. **Zoom**
   - Marketplace: https://marketplace.zoom.us/develop
   - URL: `https://your-domain.vercel.app/api/webhooks/zoom`
   - Secret Token: Copy to `ZOOM_WEBHOOK_SECRET_TOKEN`

3. **Slack**
   - API Portal: https://api.slack.com/apps → Event Subscriptions
   - URL: `https://your-domain.vercel.app/api/webhooks/slack`
   - Signing Secret: Copy to `SLACK_SIGNING_SECRET`

### Security Checklist

Before enabling production webhooks:

- [x] Implement signature verification (COMPLETE)
- [x] Add timestamp validation for Slack (COMPLETE)
- [ ] Rate limit webhook endpoints
- [ ] Monitor webhook failure rates
- [ ] Set up alerting for webhook errors
- [ ] Document webhook secret rotation procedure

## Integration Testing (Next Step)

### Current Limitation

The 4 skipped tests in `tests/api/webhooks/slack.test.ts` cannot verify Bronze layer database writes because webhook routes create their own Supabase client instances internally. Unit tests can only verify:
- ✅ HTTP responses
- ✅ Signature verification
- ✅ Async trigger mocking

But **cannot** verify:
- ❌ Actual Bronze layer inserts
- ❌ End-to-end Silver processing
- ❌ Database-level idempotency

### Implementation Plan

**See:** `docs/TODO.md` → Testing Infrastructure → Webhook Integration Tests for full details.

**Quick Summary:**

1. **Set up test Supabase project/schema**
   - Create dedicated test database
   - Seed with minimal required data

2. **Create test environment helpers**
   ```typescript
   // tests/helpers/test-db.ts
   export async function setupTestDb() {
     // Point to test database
     process.env.NEXT_PUBLIC_SUPABASE_URL = TEST_URL
     process.env.SUPABASE_SERVICE_ROLE_KEY = TEST_KEY
   }
   
   export async function resetTestDb(tables: string[]) {
     // Truncate tables between tests
     for (const table of tables) {
       await testClient.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000')
     }
   }
   ```

3. **Update skipped tests**
   ```typescript
   // Change from:
   it.skip('should upsert message to Bronze layer', async () => {
   
   // To:
   it('should upsert message to Bronze layer', async () => {
     await setupTestDb()
     await resetTestDb(['slack_messages'])
     
     // ... rest of test
     
     // Now can verify database writes!
     const { data } = await testClient
       .schema('bronze')
       .from('slack_messages')
       .select('*')
       .eq('message_ts', '1714147200.000000')
     
     expect(data).toHaveLength(1)
   })
   ```

4. **Add similar tests for Calendar and Zoom**
   - Verify `bronze.calendar_events` writes
   - Verify `bronze.zoom_meetings` writes
   - Verify `bronze.zoom_attendees` writes

5. **Verify Silver processing triggers**
   - Mock Silver processing endpoints
   - Verify they're called with correct date ranges
   - Optionally test full Bronze → Silver pipeline

**Effort:** 2-4 hours  
**Impact:** High confidence in webhook → database pipeline  
**Priority:** Medium (current tests cover security, these add E2E confidence)

### Un-skipping Tests Checklist

Once integration infrastructure is ready:

- [ ] Set up test database (Supabase project or schema)
- [ ] Create `tests/helpers/test-db.ts` with setup/reset utilities
- [ ] Update `tests/api/webhooks/slack.test.ts`:
  - [ ] Remove `.skip` from 4 tests
  - [ ] Add test database setup to `beforeEach`
  - [ ] Add Bronze layer assertions
  - [ ] Verify all tests pass
- [ ] Add Bronze verification to Calendar tests (2-3 new tests)
- [ ] Add Bronze verification to Zoom tests (2-3 new tests)
- [ ] Update this documentation with integration test examples
- [ ] Run full test suite: `npm test -- tests/api/webhooks/`
- [ ] Target: 27 passing tests (no skipped)

## Next Steps

1. ✅ **Complete** - Signature verification implementation
2. ✅ **Complete** - Signature verification tests
3. 🔲 **TODO** - Integration test infrastructure for Bronze/Silver verification (see above)
4. 🔲 **TODO** - Rate limiting for webhook endpoints
5. 🔲 **TODO** - Webhook monitoring dashboard
6. 🔲 **TODO** - Secret rotation procedure

## References

- [MSW Documentation](https://mswjs.io/docs/)
- [Google Calendar Push Notifications](https://developers.google.com/calendar/api/guides/push)
- [Zoom Webhook Reference](https://developers.zoom.us/docs/api/rest/webhook-reference/)
- [Slack Events API](https://api.slack.com/apis/connections/events-api)
