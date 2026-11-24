# Infrastructure

Setup and configuration of the services we run on.

<!-- START docs-index generated: run `pnpm docs:index` to update, don't edit by hand -->

- [Google Calendar: setup and sync](CALENDAR_SETUP.md): For Vercel/production:
- [CSP rollout alerts](CSP_ALERTS.md): The Content-Security-Policy has a strict, nonce-based script policy, enforced since 2026-11-23 (`src/lib/csp.ts`, `docs/TODO.md`, "CSP for scripts and styles (nonces)"); connection, frame, media and…
- [Deployment Guide](DEPLOYMENT.md): Production is deployed by one GitHub Actions workflow (`.github/workflows/ci.yml`) on every push to `main`
- [Environment Management Guide](ENV_MANAGEMENT.md): How environment variables are declared, where their values live, how they reach Vercel, GitHub and Supabase Vault, and how they are rotated
- [Integration Links](INTEGRATION_LINKS.md): Quick reference for managing all external service integrations
- [Kajabi API integration](KAJABI_API_SETUP.md): The Kajabi API is the only source of Kajabi data for the Hub's regular sync
- [Mux configuration as code](MUX_CONFIG.md): `config/mux.yml` is the source of truth for the Mux settings its API can manage: the webhook that tells the Hub a course video is ready, and the playback restriction (which sites may play a signed vi…
- [Outbound requests](OUTBOUND_REQUESTS.md): Every request the app makes to a server that is not ours says who we are in its `User-Agent`:
- [Sentry config as code](SENTRY_CONFIG.md): `config/sentry.yml` is the source of truth for two things in Sentry:
- [Slack app manifest as code](SLACK_MANIFEST.md): `config/slack-app-manifest.yml` is the source of truth for the Slack app (Billie Bot): its name and description, bot scopes, the `/hub` slash command, event subscriptions and request URLs
- [Slack notification operations alerts](SLACK_OPERATIONS_ALERTS.md): The Sentry Slack integration requires a Team plan, so the Hub app posts its own production alerts to the alerts channel (`slack.alertsChannelName` in `config/app.ts`) through Billie Bot
- [Vercel project config as code](VERCEL_CONFIG.md): `config/vercel.yml` is the source of truth for the Vercel project settings that `vercel.json` can't express
- [Webhook Setup Guide](WEBHOOK_SETUP.md): This guide explains how to configure and test real-time webhook handlers for Bronze layer updates
- [Webhook Testing Guide](WEBHOOK_TESTING.md): This project uses MSW (Mock Service Worker) for hermetic webhook testing with signature verification enabled for all webhooks

<!-- END docs-index -->
