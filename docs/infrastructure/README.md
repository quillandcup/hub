# Infrastructure

Setup and configuration of the services we run on.

<!-- START docs-index generated: run `pnpm docs:index` to update, don't edit by hand -->

- [Google Calendar: setup and sync](CALENDAR_SETUP.md): How to connect the Hub to Google Calendar with a service account, and how events are then synced into the Hub
- [CSP rollout alerts](CSP_ALERTS.md): How the team is alerted when the Content-Security-Policy blocks something it should not, or stops running our own scripts
- [Deployment Guide](DEPLOYMENT.md): Every push to `main` is tested, migrated and deployed to production by one GitHub Actions workflow (`.github/workflows/ci.yml`)
- [Environment Management Guide](ENV_MANAGEMENT.md): Explains how environment variables are declared, where their values live, how they reach Vercel, GitHub and Supabase Vault, and how they are rotated
- [Integration Links](INTEGRATION_LINKS.md): Dashboard links and quick facts for every external service the Hub integrates with, such as Zoom, Slack, Kajabi, Vercel and Supabase
- [Kajabi API integration](KAJABI_API_SETUP.md): How the Hub reads from and writes to Kajabi through its API, and how access is set up
- [Mux configuration as code](MUX_CONFIG.md): Mux webhook and playback restriction settings are kept as code in `config/mux.yml` and applied by an operator script
- [Outbound requests](OUTBOUND_REQUESTS.md): Every request the app makes to a server that is not ours identifies the Hub in its `User-Agent` header
- [Sentry config as code](SENTRY_CONFIG.md): Sentry's data-scrubbing settings and alert rules are kept as code in `config/sentry.yml` and pushed by CI
- [Slack app manifest as code](SLACK_MANIFEST.md): The Slack app's configuration is kept as code in `config/slack-app-manifest.yml` and pushed by CI
- [Slack notification operations alerts](SLACK_OPERATIONS_ALERTS.md): The Hub posts its own production alerts to a Slack alerts channel, covering failed notifications, crashed pages and scheduled jobs with problems
- [Vercel project config as code](VERCEL_CONFIG.md): Vercel project settings that `vercel.json` can't express are kept as code in `config/vercel.yml` and pushed by CI
- [Webhook Setup Guide](WEBHOOK_SETUP.md): How to configure and test the real-time webhooks from Google Calendar, Zoom, Slack and Resend that feed Bronze layer updates
- [Webhook Testing Guide](WEBHOOK_TESTING.md): Webhook handlers are tested without network access using MSW (Mock Service Worker), with signature verification enabled for all webhooks

<!-- END docs-index -->
