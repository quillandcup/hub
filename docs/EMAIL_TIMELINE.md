# Email on the member timeline (Resend)

What an email did after the Hub sent it (sent, delivered, opened, clicked, bounced, marked as spam, failed) shows on the member's timeline, next to their Slack activity and logins. Admins see it on the member's **Activity Log** tab and on `/admin/activity` under **Everything → Member activity**.

## Flow

```
Resend ──webhook──▶ /api/webhooks/resend ─┐
   │                                      ├─▶ bronze.resend_events ──▶ member_activities (source "resend")
   └──list emails──▶ /api/reconcile/email ─┘      (Bronze, append-only)     (Silver, rebuilt one email at a time)
```

- **Bronze**: `bronze.resend_events`, one row per event, service role only (recipients and subjects). Unique on `event_id`: the webhook's `svix-id`, or `pull:<email id>:<type>` for an event the nightly pull recovered. `ResendEventRepository` (`lib/data/resend.ts`).
- **Webhook** (`app/api/webhooks/resend/route.ts`): verifies the Svix signature on the raw body (`verifyResendSignature`, `RESEND_WEBHOOK_SECRET`), stores the event, rebuilds that email's timeline rows. A database failure answers 500 so Resend retries; the retry is a no-op. A deployed build with no secret rejects every request.
- **Nightly pull** (`app/api/reconcile/email/route.ts`, 03:45 UTC, heartbeat `reconcile-email`): lists the last 3 days of sent emails (`?days=N`, up to 90, for a backfill) and records what Bronze lacks. Resend's list reports an email's **last** event only, so it can recover that an email was sent and where it ended up (delivered, bounced, complained, failed, delayed), timed at the send. It cannot recover an open or a click the webhook missed, and does not invent one. Needs a `RESEND_API_KEY` with **full access**; a sending-only key fails the run with Resend's answer.
- **Silver**: `projectEmails` (`lib/email-events.ts`) deletes an email's `member_activities` rows (`source = 'resend'`, `related_id` = Resend's email id) and inserts what its events say now, so a retry, the nightly pull and a manual reprocess converge. Rows are `actor_kind = 'system'`, category `communication`, `engagement_value = 0` (a tracking pixel must not move an engagement score).

## What a row says

| `activity_type` | When | Notes |
|---|---|---|
| `email_sent` | the send | `data.delivered_at` when delivered; delivery has no row of its own |
| `email_opened` | the first open | one row per email, `data.open_count`; mail apps that prefetch images report an open per device |
| `email_clicked` | every click | the description is the link **without its query string or fragment** |
| `email_bounced` | a bounce | type and Resend's message |
| `email_complained` | marked as spam | |
| `email_failed` | failed, suppressed or delayed | `data.reason` says which |

`data` also holds `email_id`, `subject`, `kind` (the notification kind, null for mail without our tag) and `resend_url`. The feed row opens to a **Read this email at Resend** link (only a `resend.com/emails/<id>` address is ever rendered as a link, `emailLinkOf`). The body is not copied into the Hub.

## Which member

`membersForEmails`: the `member` tag the Hub put on the email when it still names a member, otherwise the member whose address it went to (members' addresses; aliases are not consulted). An email nobody matches writes no rows; its events stay in Bronze and are projected on the next run after the member exists.

`sendEmail` (`lib/email.ts`) tags every Hub email with `kind` and `member`. In test mode (`EMAIL_TEST_MODE`) the `member` tag is left off, because the email goes to `EMAIL_DEV_ADDRESS` and must not land on a real member's timeline.

**Supabase Auth emails** (sign-in links, invites) go over Resend SMTP, which cannot carry per-email tags, so they match by address only and have `kind` null. The launch emails are sent by `scripts/send-launch-emails.ts` through `sendEmail` with `kind: launch`.

## Secrets

A clicked link can carry a one-time sign-in token. `stripLinkSecrets` removes the query string and fragment before anything is stored, in `link` and in the raw payload. Don't add a path that stores a click's URL unstripped.

## Setting it up

Step by step, with testing and troubleshooting: `docs/WEBHOOK_SETUP.md`, "Resend Webhooks". In short: `RESEND_API_KEY` must be **Full access** (the nightly pull lists emails; Resend has only Full and Sending access, and the permission of an existing key can be changed in place), add the webhook in Resend for the events listed there, put its signing secret in the env files as `RESEND_WEBHOOK_SECRET` and `pnpm env:sync --only=RESEND_WEBHOOK_SECRET`, turn tracking on for the sending domain if you want opens and clicks, then backfill with `/api/reconcile/email?days=90` as an admin.

The nightly import has **no heartbeat monitor** for now: the Hobby plan allows 10 uptime monitors and all 10 are used, so `reconcile-email` is marked `unmonitored` in `lib/cron-heartbeats.ts`. A failing import (for example a sending-only API key) shows only in the Vercel logs. When there is room, delete that line, deploy the checks, copy the new heartbeat's ping URL into `.env.prod` as `CHECKLY_HEARTBEAT_RECONCILE_EMAIL` and `pnpm env:sync`.

## Not built yet

Replies (inbound mail), reading an email's body inside the Hub, retention and removal of the Bronze table: see `docs/TODO.md`, "Email timeline: what is left".
