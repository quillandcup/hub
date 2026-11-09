# Changelog

What's new and fixed in the Hedgie Hub, for members. One source, three readers.

- **Source:** `lib/changelog/entries.ts`, a typed list. Add an entry in the same PR as the change it describes, so it goes live with the deploy that ships the feature.
- **In the app:** `/changelog` (list) and `/changelog/<slug>` (one entry, with its own link), reached from the **?** menu in the top bar.
- **In the admin space:** `/admin/changelog` (list, with month headings) and `/admin/changelog/<slug>`: every entry, product and engineering, with search and filters for category and audience (Product / Engineering / All). The member page has the same search and the category filter. There is no generated `CHANGELOG.md`; `tests/lib/changelog.test.ts` fails when an entry is malformed or shows an image that is not there.
- **Digest:** a weekly "What's new" notification (kind `changelog_digest`, "News about the Hub" in Settings → Notifications), so each member chooses Slack, in-app, email or browser push. `/api/internal/changelog-digest` runs Tuesdays 14:00 UTC from `vercel.json` (`lib/changelog/digest.ts`).
- **Announcements channel:** the same run posts the new entries (excerpt, screenshot, link to `/changelog`) to the channel in `app.config.ts` (`slack.changelogChannelId`). That is a shared-room post, a direct Slack post like the Wheel of Wonder intro, not a notifier send. It is open to every member, so an entry's text must be fit for all of them. Outside production nothing is posted (`SLACK_TEST_MODE`); it is logged.

**Writing guidance for people and agents** lives in `.claude/rules/changelog-writing.md`, and `.claude/skills/member-reader-review` reviews copy as a busy member would read it (run it before publishing a batch of entries).

## Two audiences

Every entry has an `audience`:

- **`product`**: what a member can now do or what got fixed. It shows on the What's new pages (with its own link), in the weekly digest, and in the announcements post, and on the admin Changelog. This is the main thing.
- **`engineering`**: platform improvements (CI, test frameworks, the repository pattern, safety checks) or the lower-level detail behind a product update (the notifier and its routing behind a notification feature). It appears **only on the admin Changelog**, with its body, tagged "Engineering": no member page, no notification. It has no screenshots (the validator refuses them). Say in the body which product entry it relates to, if any.

**Backfilled history never notifies.** `changelogDigestStartsOn` in `app.config.ts` is the first day an entry can go out in the digest or the channel post; entries dated before it are on the pages only. Set it to the day the digest goes live when adding a batch of past entries.

## Writing an entry

- `major: true` marks a significant new capability (Hub Chat, Courses), not one more improvement: it is badged on the What's new pages, first in the weekly digest and the announcements post, and marked on the admin Changelog. It is a separate dimension from `category` (a major feature is also "new"), product entries only, and rare on purpose.
- `category`: `new`, `improved` or `fixed`. Only things a member would notice; skip refactors and internal tooling.
- `summary`: one or two plain sentences, no markdown (it is the excerpt in the list, digests and Slack). Say what the member can now do.
- `body`: markdown. Link Hub pages as `/path`.
- `slug`: the permalink. Never change it after publishing.
- Dates are the Eastern day it shipped. **A feature behind a feature flag ships the day the flag goes on for everyone**, not the day its code merged: write the entry then (and an engineering entry for the code, if useful). Find that moment in the audit log, read-only: `supabase db query --linked "select entity_id, occurred_at at time zone 'America/New_York', changes from audit_log where entity_type = 'feature_flag' order by occurred_at"` (`enabled_globally` going true). A flag that is off for everyone is not a product update yet.
- **One story per feature, written when members can use it.** Many pull requests and commits make one thing members get; write one entry for it, dated the day it became available, with the benefit first and what is in it as a short list. Do not write an entry per pull request (chat was fourteen entries and read like a developer diary). Keep the lower-level detail in an `engineering` entry. Later improvements to something members already have are their own entries.
- **Milestones are not entries.** A demo, a launch day or a "special reveal" has no version to bump, so it does not go in the changelog; write entries for what members can do.

## Screenshots

An entry's screenshots are **frozen at ship time**: taken once from the demo community, committed, and left alone (the help screenshots, by contrast, are regenerated per build). They live in `public/changelog/<slug>/`, so Slack and email can fetch them, and are referenced as `/changelog/<slug>/<file>.webp` in `body` (and in `image` for the one shown on the list, in the digest and in the Slack post). The repo and that folder are public: sample data only, never a real member's name, photo or message. Images must live in the entry's own folder, and every one an entry shows must exist (`tests/lib/changelog.test.ts`).

To take them:

1. Add the entry to `lib/changelog/entries.ts` (a `product` one).
2. Write a scene at `demo/scenes/changelog/<slug>.spec.ts`, tagged `@changelog` in its test title, that signs in as a demo persona, drives the feature and calls `shot()` (see `whats-new-changelog.spec.ts`). Like every scene it also runs the page checks (accessibility, overflow, console), so it doubles as a test of the feature: the first run on this page found a contrast bug.
3. With the demo stack up (`pnpm demo:stack up`), the demo app running (`pnpm demo:app`; another port with `DEMO_APP_URL`) and the community seeded (`pnpm demo:seed`), run `pnpm changelog:capture <slug>`. It runs that scene on desktop light and writes the screenshots into `public/changelog/<slug>/` as **WebP, at most 1200 px wide** (about a quarter of the PNG: the repo keeps every version of every image forever, so they are kept small). Reference them as `.webp`.
4. Open every image and check it shows no real data, delete the ones the entry doesn't use, then reference them from the entry and commit them.

`@changelog` scenes are left out of the scheduled help-screenshots run (`--grep-invert "@published|@changelog"`), which tracks the current UI: a scene for an old entry may stop matching the app, and that is fine, it is the record of how the screenshots were taken.

## Drafting entries

Entries written one PR at a time read like a developer diary, so there is a drafter that works the other way: it looks at everything merged in a window and proposes **stories**, which a person then reviews.

`pnpm changelog:draft [--since YYYY-MM-DD] [--run]` lists the PRs merged to `main` since that day (default 14 days) with `gh`, drops the ones that only touch docs, tests or the changelog, and writes `demo/out/changelog-draft/prompt.md` (the PRs, the entries that already exist in the window, and an instruction to follow `.claude/rules/changelog-writing.md` and this document). With `--run` it pipes the prompt to `claude -p` and writes `drafts.md`: entry literals in the `ChangelogEntry` shape, the PRs each came from, a demo-scene suggestion, and a list of PRs it skipped or that need a human (a feature behind a flag, an unclear claim). Nothing is written to `lib/changelog/entries.ts`.

It uses the Claude Code CLI, not an SDK: nothing is added to `package.json` or to the app, and no member data is involved (it reads public PR text). Keep it that way, because the "no AI touches your writing" statement is checked against the dependencies and the code (`.claude/rules/changelog-writing.md`).

A draft is a starting point. Before it goes in: check every claim against the PR and the code, set the date to the day members could use it (for a flagged feature, the day the flag went on for everyone, from the audit log), run the member reader review, write the scene and take the screenshots. A window of about four days is about 140k characters of prompt; a nightly run covers a day or two, and a two-week window is too large for one call.

## How the digest decides what to send

- **Entries from the last 30 days** (`DIGEST_WINDOW_DAYS`) that the recipient has not been sent. Each entry is claimed per recipient in `notification_log` (kind `changelog_digest`, dedup key = the slug) before the send and given back when no channel delivered it. So a retry or a second run sends nothing twice, a missed week catches up on the next run, and a member who turns a channel on later still gets what they missed. A week with nothing new sends nothing.
- **Product entries only**, and none dated before `changelogDigestStartsOn` (see "Two audiences").
- **One message**, not one per entry: a single new entry reads as that entry; several are a roundup of up to **three**, most valuable first (new, then improved, then fixed), with a link to the rest. A busy reader skims three and mutes five.
- **A week of only fixes sends nothing.** No claim is taken, so those fixes ride along with the next entry that has something new (within the 30-day window).
- **Dry run first** (`CLAUDE.md`, "A new automated sender starts in dry run"): the `changelog_digest` feature flag says who gets it for real (an admin's own preview, a segment, or everyone). For the others the job only logs the member id, channels, entries and text. The channel post goes out only when the flag is on for everyone. Read the logs of the first run or two (`node_modules/.bin/vercel logs ... --query "changelog-digest"`) before widening.
- **Run it by hand** by opening `/api/internal/changelog-digest` as an admin; it is idempotent.
- **Why Vercel Cron, not pg_cron:** a weekly job belongs in `vercel.json` with the other daily and weekly jobs; pg_cron only runs the 5-minute check-ins and the hourly reminders.
