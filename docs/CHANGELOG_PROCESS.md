# Changelog

What's new and fixed in the Hedgie Hub, for members. One source, three readers.

- **Source:** `lib/changelog/entries.ts`, a typed list. Add an entry in the same PR as the change it describes, so it goes live with the deploy that ships the feature.
- **In the app:** `/changelog` (list) and `/changelog/<slug>` (one entry, with its own link), reached from the **?** menu in the top bar.
- **In the repo:** `CHANGELOG.md`, generated with `pnpm changelog:generate`. `tests/lib/changelog.test.ts` fails when it is stale or an entry is malformed.
- **Digest:** a weekly "What's new" notification (kind `changelog_digest`, "Product updates" in Settings → Notifications), so each member chooses Slack, in-app, email or browser push. `/api/internal/changelog-digest` runs Tuesdays 14:00 UTC from `vercel.json` (`lib/changelog/digest.ts`).
- **Announcements channel:** the same run posts the new entries (excerpt, screenshot, link to `/changelog`) to the channel in `app.config.ts` (`slack.changelogChannelId`). That is a shared-room post, a direct Slack post like the Wheel of Wonder intro, not a notifier send. It is open to every member, so an entry's text must be fit for all of them. Outside production nothing is posted (`SLACK_TEST_MODE`); it is logged.

## Writing an entry

- `category`: `new`, `improved` or `fixed`. Only things a member would notice; skip refactors and internal tooling.
- `summary`: one or two plain sentences, no markdown (it is the excerpt in the list, digests and Slack). Say what the member can now do.
- `body`: markdown. Link Hub pages as `/path`.
- `slug`: the permalink. Never change it after publishing.
- Dates are the Eastern day it shipped.

## Screenshots

Put images in `public/changelog/<slug>/` and reference them as `/changelog/<slug>/<file>.png` in `body` (and in `image` for the one shown on the list). The repo and that folder are public: use sample data, never a real member's name, photo or message. Images must live in the entry's own folder; the validator rejects anything else.

## How the digest decides what to send

- **Entries from the last 30 days** (`DIGEST_WINDOW_DAYS`) that the recipient has not been sent. Each entry is claimed per recipient in `notification_log` (kind `changelog_digest`, dedup key = the slug) before the send and given back when no channel delivered it. So a retry or a second run sends nothing twice, a missed week catches up on the next run, and a member who turns a channel on later still gets what they missed. A week with nothing new sends nothing.
- **One message**, not one per entry: a single new entry reads as that entry; several are a roundup of up to five with a link to the list.
- **Dry run first** (`CLAUDE.md`, "A new automated sender starts in dry run"): the `changelog_digest` feature flag says who gets it for real (an admin's own preview, a segment, or everyone). For the others the job only logs the member id, channels, entries and text. The channel post goes out only when the flag is on for everyone. Read the logs of the first run or two (`node_modules/.bin/vercel logs ... --query "changelog-digest"`) before widening.
- **Run it by hand** by opening `/api/internal/changelog-digest` as an admin; it is idempotent.
- **Why Vercel Cron, not pg_cron:** a weekly job belongs in `vercel.json` with the other daily and weekly jobs; pg_cron only runs the 5-minute check-ins and the hourly reminders.
