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

## Next Steps

1. ✅ **Complete** - Signature verification implementation
2. ✅ **Complete** - Signature verification tests
3. 🔲 **TODO** - Integration test infrastructure for Bronze/Silver verification
4. 🔲 **TODO** - Rate limiting for webhook endpoints
5. 🔲 **TODO** - Webhook monitoring dashboard
6. 🔲 **TODO** - Secret rotation procedure

## References

- [MSW Documentation](https://mswjs.io/docs/)
- [Google Calendar Push Notifications](https://developers.google.com/calendar/api/guides/push)
- [Zoom Webhook Reference](https://developers.zoom.us/docs/api/rest/webhook-reference/)
- [Slack Events API](https://api.slack.com/apis/connections/events-api)
