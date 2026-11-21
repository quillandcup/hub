---
paths:
  - "lib/notifications/**"
  - "lib/channels/**"
  - "lib/member-reminders.ts"
  - "lib/notification-test.ts"
  - "lib/slack.ts"
  - "lib/email*.ts"
  - "emails/**"
  - "app/**/notifications/**"
  - "app/api/internal/**"
---

### Member Notifications

**RULE**: Anything the app sends a member on its own initiative (reminders, check-ins, alerts) goes through `createNotifier` (`lib/notifications/notify.ts`) as a notification kind registered in `lib/notifications/registry.ts`, never a direct `sendSlackDM`/`chat.postMessage`. That's what makes it show up on `/settings/notifications` and honor the member's opt-outs and channel choices, and it's how new channels (email, push, SMS...) reach every kind at once.

```typescript
const notifier = await createNotifier(serviceRoleClient, "prickle_checkin", memberIds); // batched lookups
for (const memberId of memberIds) {
  if (!notifier.canReach(memberId)) continue; // check BEFORE claiming a dedup row
  // ...claim the send in the feature's dedup log...
  const delivered = await notifier.send(memberId, { text, url, slackBlocks }); // [] if nothing went out
}
```

**Time-sensitive or not**: set `timeSensitiveUntil` on the message only for something worth interrupting the member for, and only until it stops being so: a check-in until the prickle starts, a check-out for a few hours after it ends. Each channel interprets it (in-app: a banner until then, otherwise just under the bell; push could map it to the OS's time-sensitive level). Leave it out for anything that can wait. Set `ref` so the feature can `resolveInAppNotifications` (mark it read) once it's dealt with; nothing is ever dropped from the inbox.

Layers: **channels** (`lib/channels/`: Slack, in-app, browser push and email today, later SMS/WhatsApp) are the shared delivery adapters; **notifications** sit on them and add per-kind member preferences; **messaging** (two-way chat, planned) will use the same adapters. Never call a provider from a feature. Adding a channel: `CHANNELS` entry in `lib/channels/catalog.ts` + adapter + register it in `lib/channels/index.ts`; no migration.

**Email**: the `email` channel sends to `members.email` through Resend's API (`lib/email.ts`; `RESEND_API_KEY`, sender in `config/app.ts`). It is off by default (no kind lists it in `defaultChannels`); members opt in per kind in settings. Flipping that default later is safe: `notification_preferences` rows exist only for explicit choices (even ones matching the default), so only members who never chose change. Each kind has a React Email template in `emails/notifications/` (TypeScript fails until a new kind has one), rendered to HTML and plain text *at send time*, not pushed anywhere: Supabase's email templates (`supabase/emails/` -> `supabase/templates/`, pushed with the config) only cover its own auth emails, and its mailer can't send anything else. Every email has a per-kind unsubscribe, built by the channel from a signed token (`lib/email-unsubscribe.ts`, `EMAIL_UNSUBSCRIBE_SECRET`, never rotate: old emails' links would break): a footer link to the public `/unsubscribe?t=` page (shows the state, a button to unsubscribe or turn back on, a link to settings; viewing never changes anything, since link scanners open every link) and `List-Unsubscribe`/`List-Unsubscribe-Post` headers for mail clients' own button, which POST to `/api/email/unsubscribe` (no GET handler, on purpose). Both write the same `notification_preferences` row as the settings page. Outside production `sendEmail` redirects to `EMAIL_DEV_ADDRESS` (like `SLACK_TEST_MODE`), so local and preview never email real members.

**Adding a kind** also needs its sample message in `sampleMessages` (`lib/notification-test.ts`; TypeScript fails until it has one), which powers Admin → Test Notifications (`/admin/notifications`): every kind on every channel, sent to the admin's own accounts.

**Slack notification delivery**: Automatic Slack DMs follow each member's per-kind channel preferences and require a safe Slack account match. Keep production `SLACK_TEST_MODE=false`; local and preview sends redirect to the dev account. Ambiguous matches are rejected, logged and reported to Sentry and `#hub-alerts`. A failed Slack post is logged and reported there too. A member without any reachable channel does not consume a notification dedup claim. A member with another successful channel does consume it, so a failed Slack DM is not retried for that notification.

Exceptions that stay direct: replies the member just asked for (Slack sign-in link; the email-alias verification link, `lib/email-verification.ts`, which goes to the address being verified rather than `members.email`; the "your email was changed" notice to the old and new address after a primary email changes (by an admin or by the member), `lib/email-change-notice.ts`), shared rooms (Wheel of Wonder intro), and celebrations of a member's wins in #hedgiehype (`celebrateNewBook`, `celebrateNewAward`), staff-channel posts (the feedback widget). For a send the member explicitly requested that should still look like the notification (admin test DMs), use `createNotifier(..., { channels: ["slack"] })`, which skips preferences.

### Notification Messages: Links, Copy, Rollout

What the message says and where it leads matters as much as how it's routed (the section above).

- **Link to the exact thing.** A message about X opens X, not a page that merely relates to it: a check-out DM links to the check-out, and a "Check in" link that lands on a prickle page showing nothing about check-in is a bug. Send yourself the test message (Admin → Test Notifications, `/admin/notifications`; locally with Mailpit) and click the link before shipping.
- **No link previews in what the app sends on its own.** Notifications, DMs, reminders, alerts and staff posts set `unfurl_links: false` and `unfurl_media: false` (see `lib/slack.ts`): a preview card under an automated message is noise. The notifier and the Slack helpers already do; any new automated send must too. **A message a person wrote is different.** A chat message a member wrote in the Hub, posted to Slack as that member (`lib/chat/slack-post.ts`), is conversation, so Slack unfurls it like any Slack message (today only for senders who have the `chat_link_previews` flag, which is on for everyone: remove the check when the flag is removed).
- **Say what and ask the question**, in the voice of the existing messages: "Ready for {type} in ~20 min? Check in: how are you feeling coming in?", not a bare "Check in: {type}". Keep it short. Test sends are prefixed "[Test] ".
- **Escape going out, decode and resolve coming in.** Slack text writes `&`, `<`, `>` as `&amp;`, `&lt;`, `&gt;`, and mentions and channels are tokens (`<@U…>`, `<#C…>`). Escape what you send; decode entities and resolve tokens to names for what you display (`lib/chat/render.ts`, `lib/chat/names.ts`). A literal `&amp;`, `#channel` or a user id on screen is this bug. Test with a name that contains `&` and `<`.
- **A new automated sender starts in dry run.** Put it behind a feature flag per kind that says who gets it for real (`liveFor` in `lib/member-reminders.ts`, the `prickle_reminders` flag in `lib/features.ts`); for everyone else it only logs the member id, kind, why, channels and message, and writes no dedup or backoff row, so switching it on later starts from a clean slate. Read the logs for a run or two, then widen: yourself, a segment, everyone.
