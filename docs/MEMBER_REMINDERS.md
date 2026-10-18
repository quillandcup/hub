# Member Reminders

Two reminders the Hub sends on its own, from one hourly job.

| Kind | Says | Stops |
|------|------|-------|
| `intro_nudge` | Introduce yourself in #start-here | After 4, or once the member posts at top level there |
| `prickle_nudge` | Put a prickle on your calendar ("first", "we miss you" or "next", by history) | Never; backs off, and starts over after they attend |

Both are notification kinds (`lib/notifications/registry.ts`), so members choose channels per kind in Settings. `intro_nudge` defaults to Slack and in-app; `prickle_nudge` is off until a member opts in.

## Rules

- **Who**: active members. A newcomer (`lib/newcomer.ts`) for the intro; the intro reminder also needs a matched Slack user, since otherwise we can't see an introduction.
- **When**: the first one goes out on day 2 after joining (the welcome emails cover day 1). Intro: weekly, 4 times. Prickle: weekly for 4, every 2 weeks for 4, then monthly.
- **Spread out**: each reminder goes in its own hour (9:00 to 17:59) in the member's Settings time zone, else the org zone, and the gap is nudged about 15% (`lib/nudge-jitter.ts`).
- **Wording**: "first prickle" only for members who joined on or after `ATTENDANCE_DATA_STARTS_ON`; older members get "next" or "we miss you".
- **Links**: the intro reminder links to #start-here in Slack (an allowed external link in the in-app channel, `lib/notification-links.ts`); the prickle one links to `/my-prickles`.
- Code: `lib/member-reminders.ts`, route `app/api/internal/member-reminders/route.ts`, pg_cron job `send-member-reminders`, log table `member_reminder_log`, heartbeat `member-reminders` (see `docs/INTEGRATION_LINKS.md`).

## Feature flags and rollout

Two flags, both off: `intro_reminders` and `prickle_reminders`. For anyone a flag doesn't cover, the job only logs `[member-reminders] DRY RUN <kind> {...}` (who, channels, why, text, url) and sends, records and marks nothing, so the log shows what would go out.

1. Leave both off and read the dry-run lines in the Vercel logs for a few days.
2. Turn a flag on for yourself (a personal preview) to see it live on your own account.
3. Turn it on for a segment, then globally.

The job only sends to members who are due, in their hour. There's no force-send today, so to see a real one on your own account you need to be due (e.g. locally, set your member's `first_joined_at` a few days back, no log rows, and call the route with the cron secret in your hour).
