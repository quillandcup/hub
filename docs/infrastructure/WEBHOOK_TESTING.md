# Webhook Testing Guide

> **Status:** living. **Last reviewed:** 2026-11-24. Review: yearly. Kept up to date with the code; if it is wrong, fix it.

Webhook handlers are tested without calling the vendors: each test builds a signed request, calls the route handler directly and checks the response and what was written, with signature verification covered for every webhook.

For configuring the webhooks at the vendors, see [WEBHOOK_SETUP.md](WEBHOOK_SETUP.md).

## Webhooks and how each is verified

The routes live in `src/app/api/webhooks/`. Shared helpers are in `src/lib/webhook-auth.ts` (`webhookSecretRequired`, `secretsMatch`) and `src/lib/slack-signature.ts`.

| Webhook | Route | Verification | Env var (`config/env-vars.ts`) |
|---|---|---|---|
| Google Calendar | `src/app/api/webhooks/calendar/route.ts` | `X-Goog-Channel-Token` header, constant-time compare with the token set when the watch channel was created | `GOOGLE_CALENDAR_WEBHOOK_TOKEN` |
| Zoom | `src/app/api/webhooks/zoom/route.ts` | HMAC-SHA256 of `v0:{timestamp}:{body}` in `X-Zm-Signature`; the secret of any configured Zoom account may match (`src/lib/zoom-accounts.ts`); always required | `ZOOM_WEBHOOK_SECRET_TOKEN`, `ZOOM_SECONDARY_WEBHOOK_SECRET_TOKEN` |
| Slack (events) | `src/app/api/webhooks/slack/route.ts`, handled in `src/modules/chat/slack/webhook.ts` | HMAC-SHA256 in `X-Slack-Signature`, requests older than 5 minutes rejected (`verifySlackSignature`) | `SLACK_SIGNING_SECRET` |
| Slack (slash commands, interactivity) | `src/app/api/webhooks/slack/commands/route.ts`, `src/app/api/webhooks/slack/interactions/route.ts` | same `verifySlackSignature` | `SLACK_SIGNING_SECRET` |
| Resend | `src/app/api/webhooks/resend/route.ts` | Svix signature (`svix-id`, `svix-timestamp`, `svix-signature`, HMAC-SHA256 over `{id}.{timestamp}.{body}`, timestamp tolerance) in `verifyResendSignature`, `src/lib/email-events.ts` | `RESEND_WEBHOOK_SECRET` |
| Mux | `src/app/api/webhooks/mux/route.ts` | The Mux SDK's `webhooks.unwrap` (`unwrapWebhook`, `src/lib/mux.ts`) checks the signature and timestamp on the raw body; no unsigned path | `MUX_WEBHOOK_SECRET` |

**When the secret is not configured:** a deployed build (`NODE_ENV=production`, so Vercel production and preview) rejects every Calendar, Slack and Resend request, so a missing variable can't turn verification off (`webhookSecretRequired`). Local `next dev` and tests accept them unverified. Zoom and Mux never accept an unsigned request, locally either.

## Where the tests are

| Webhook | Tests |
|---|---|
| Calendar | `tests/api/webhooks/calendar.test.ts` (also `tests/lib/google-calendar/`) |
| Zoom | `tests/api/webhooks/zoom.test.ts`, `tests/lib/zoom-webhook-accounts.test.ts` |
| Slack events | `tests/api/webhooks/slack*.test.ts` (messages, DMs, reactions, file deletes, gap fill, error handling), `tests/lib/slack-webhook-replay.test.ts` |
| Slack commands and interactivity | `tests/lib/slack-quick-log.test.ts`, `tests/lib/slack-checkin-submit.test.ts` |
| Resend | `tests/lib/resend-routes.test.ts` |
| Mux | `tests/api/webhooks/mux.test.ts`, `tests/api/webhooks/mux-upload.test.ts`, `tests/lib/mux-webhook-alerts.test.ts` |

Each suite covers the signature (valid, invalid, missing, stale where the scheme has a timestamp), the handler's response, idempotent redelivery and the failure paths. Files under `tests/api/` run in the `db` project and need the local Supabase stack; files under `tests/lib/` run in the `unit` project (`config/vitest.mts`).

## Running tests

```bash
# The db project (needs the local Supabase stack), which holds most webhook tests
pnpm test:db

# The unit project
pnpm test:unit

# One file or folder
pnpm test:run tests/api/webhooks/
pnpm test:run tests/api/webhooks/calendar.test.ts
pnpm test:run tests/lib/resend-routes.test.ts
```

Do not copy pass counts into this doc: they go stale. CI runs both projects on every PR.

## Test infrastructure

- `tests/helpers/webhook-helpers.ts`: loads the Calendar, Zoom and Slack fixtures.
- `tests/fixtures/webhooks/`: sample payloads (`calendar/`, `zoom/`, `slack/`).
- `tests/helpers/resend-event-contract.ts`: the contract suite for the Resend events repository.
- `tests/setup-msw.ts`: an MSW server that the few files that need to intercept outgoing HTTP import; it is not part of the global setup (`config/vitest.mts`).
- Signed requests are built in each test with `crypto.createHmac`, using the same scheme as the route.

## Production webhook setup

Set the secrets in Vercel project settings (names and meaning in `config/env-vars.ts`, procedure in `.claude/rules/new-env-var.md`). Configure each vendor to call:

1. **Google Calendar**: `https://<domain>/api/webhooks/calendar`, with the channel token equal to `GOOGLE_CALENDAR_WEBHOOK_TOKEN`.
2. **Zoom**: `https://<domain>/api/webhooks/zoom`, with the app's secret token copied to `ZOOM_WEBHOOK_SECRET_TOKEN` (or the `ZOOM_SECONDARY_` variable for the second account).
3. **Slack**: `https://<domain>/api/webhooks/slack` (Event Subscriptions), `/api/webhooks/slack/commands` and `/api/webhooks/slack/interactions`, with the signing secret in `SLACK_SIGNING_SECRET`.
4. **Resend**: `https://<domain>/api/webhooks/resend`, with the signing secret in `RESEND_WEBHOOK_SECRET`.
5. **Mux**: `https://<domain>/api/webhooks/mux`, with the signing secret in `MUX_WEBHOOK_SECRET`. Preview deployments poll Mux instead (their URLs change).

### Security checklist

- [x] Signature verification on every webhook
- [x] Timestamp validation (Slack, Resend, Mux)
- [ ] Rate limit webhook endpoints
- [ ] Monitor webhook failure rates
- [ ] Set up alerting for webhook errors
- [ ] Document webhook secret rotation procedure

## References

- [MSW Documentation](https://mswjs.io/docs/)
- [Google Calendar Push Notifications](https://developers.google.com/calendar/api/guides/push)
- [Zoom Webhook Reference](https://developers.zoom.us/docs/api/rest/webhook-reference/)
- [Slack Events API](https://api.slack.com/apis/connections/events-api)
- [Resend Webhooks](https://resend.com/docs/dashboard/webhooks/introduction)
- [Mux Webhooks](https://www.mux.com/docs/core/listen-for-webhooks)
