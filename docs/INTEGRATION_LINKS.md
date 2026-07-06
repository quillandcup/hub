# Integration Links

Quick reference for managing all external service integrations. These dashboards are hard to find — bookmark this file.

## Zoom

**App:** https://marketplace.zoom.us/develop/apps/gcFgx-76S8aaL4AiYqaHng/credentials

| Page | URL |
|------|-----|
| Credentials | https://marketplace.zoom.us/develop/apps/gcFgx-76S8aaL4AiYqaHng/credentials |
| Event Subscriptions (webhook URL + events) | https://marketplace.zoom.us/develop/apps/gcFgx-76S8aaL4AiYqaHng/event-subscriptions |
| App Information | https://marketplace.zoom.us/develop/apps/gcFgx-76S8aaL4AiYqaHng/information |

Webhook URL: `https://hub.quillandcup.com/api/webhooks/zoom`
Webhook secret env var: `ZOOM_WEBHOOK_SECRET_TOKEN`

---

## Slack

**App:** https://api.slack.com/apps/A0AS93BKT09

| Page | URL |
|------|-----|
| Event Subscriptions (webhook URL) | https://api.slack.com/apps/A0AS93BKT09/event-subscriptions |
| OAuth & Permissions (bot token) | https://app.slack.com/app-settings/T01NPHKSMA9/A0AS93BKT09/oauth |
| Basic Information (signing secret) | https://api.slack.com/apps/A0AS93BKT09/general |

Webhook URL: `https://hub.quillandcup.com/api/webhooks/slack`
Signing secret env var: `SLACK_SIGNING_SECRET`

---

## Google Calendar / Google Cloud

**Calendar API (project: quillandcup):** https://console.cloud.google.com/apis/api/calendar-json.googleapis.com/metrics?project=quillandcup

| Page | URL |
|------|-----|
| Service Accounts | https://console.cloud.google.com/iam-admin/serviceaccounts?project=quillandcup |

Calendar ID: `dd6745e544f1a8a93f0f7fd6d3fc633ab9c864e1090603a793c69d101f695e6e@group.calendar.google.com`
Service account: `quill-cup-admin-portal@quillandcup.iam.gserviceaccount.com`

Webhook URL: `https://hub.quillandcup.com/api/webhooks/calendar`
Webhook token env var: `GOOGLE_CALENDAR_WEBHOOK_TOKEN`

Note: Google Calendar webhooks are push notifications set up via API call (not a UI toggle). See `WEBHOOK_SETUP.md` for the `curl` command to register a watch channel.

---

## Kajabi

| Page | URL |
|------|-----|
| Dashboard | https://app.kajabi.com/admin/sites/2147577478/dashboard |
| API Keys | https://app.kajabi.com/admin/settings/public_api |
| Webhooks | https://app.kajabi.com/admin/sites/2147577478/integrations/webhooks |

Site ID: `2147577478`
Client ID: `2cSHfWmtiVw7By2axBgQrPdi`

Note: Kajabi webhooks only support "Payment Succeeded" and "Cart Purchase" events — we don't use them. The Silver layer is reconciled nightly at 3 AM via `/api/reconcile/members` (Vercel cron), but that only reprocesses existing Bronze snapshots — getting fresh data from Kajabi still requires a manual CSV import.

---

## Vercel

**Project:** https://vercel.com/quillandcup/hub

| Page | URL |
|------|-----|
| Deployments | https://vercel.com/quillandcup/hub/deployments |
| Logs (unified) | https://vercel.com/quillandcup/hub/logs |
| Analytics | https://vercel.com/quillandcup/hub/analytics |
| Speed Insights | https://vercel.com/quillandcup/hub/speed-insights |
| Environment Variables | https://vercel.com/quillandcup/hub/settings/environment-variables |

Production URL: `https://hub.quillandcup.com`

---

## Supabase

| Environment | URL |
|-------------|-----|
| Production | https://supabase.com/dashboard/project/bxwtougjidectvjegdlr |
| Development | https://supabase.com/dashboard/project/odgzkogzmzcnwgyfqvvt |
