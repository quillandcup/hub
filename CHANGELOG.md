# Changelog

<!-- Generated from lib/changelog/entries.ts by `pnpm changelog:generate`. Edit the entries, not this file. -->

What's new and fixed in the Hedgie Hub, newest first.

## 2026-11-04 · Engineering · New: Changelog system, weekly digest and one notification log

Changelog entries live in one typed file that feeds the What's new pages, CHANGELOG.md, the weekly digest and the announcements post.

`lib/changelog/entries.ts` is the single source. Each entry is for the `product` audience (members: the pages, the digest, the announcements post and CHANGELOG.md) or the `engineering` audience (CHANGELOG.md only). CHANGELOG.md is generated with `pnpm changelog:generate` and a test fails when it is stale or an entry is malformed.

The weekly digest is the `changelog_digest` notification kind, sent by `/api/internal/changelog-digest` from Vercel Cron (Tuesdays 14:00 UTC) behind the `changelog_digest` feature flag, so it starts in dry run. Each member gets the entries from the last 30 days they have not had, as one message on the channels they chose, and nothing dated before `changelogDigestStartsOn` in `app.config.ts` is ever sent.

`notification_log` is one log of what the app sent, for every kind: a row per recipient (a member, or a shared place such as a Slack channel), kind and dedup key. A send is claimed before it is made and released when nothing was delivered, so a retry or an overlapping run never sends twice. `NotificationLogRepository` has an in-memory twin and one contract suite run against both.

Screenshots are taken from the demo scenes: `pnpm changelog:capture <slug>` runs an `@changelog` scene and writes small WebP files into `public/changelog/<slug>/`.

## 2026-11-04 · New: A changelog for the Hedgie Hub

See what is new and fixed in the Hub on a What's new page, and choose how you hear about it: a weekly roundup on Slack, in the Hub or by email.

## 2026-11-03 · Engineering · New: Member data removal routine and a Community Manager role

A routine removes a member's data on request, and a read-only Community Manager role opens a fixed set of admin pages.

The removal routine has a staff entry point and a decision for every table that holds member data. Admins can preview the admin area as a Community Manager, and new admin pages stay closed to that role until they are added on purpose.

## 2026-11-03 · Engineering · New: Slack DM bridge, switched off

One-on-one Slack DMs can be pulled into chat for the members a feature flag covers, read with each member's own Slack token.

It has live delivery of new messages, a nightly pull, and a way to start a Slack DM from a profile's Message button. The feature is off for everyone as of this entry. /privacy describes what is read and kept, and the choice is to disconnect Slack. It becomes a product entry when it is on for everyone.

## 2026-11-03 · Fixed: Fixes to chat, course videos, check-in messages and sign-in

Fixes to chat, course videos, Slack check-in messages and the sign-in page.

## 2026-11-03 · Improved: One book, print and ebook

A book on your shelf can have a print edition and an ebook edition, each with its own link and price, on one card.

## 2026-11-02 · Engineering · New: Launch tooling

Sign-in accounts were created in advance for members, then released and emailed in batches, each with its own sign-in code.

pnpm auth:precreate and pnpm launch:email did the rollout. Both default to a dry run and take --limit and --only to trial it first, and the email can be re-run safely because each sent member is marked.

## 2026-11-02 · Engineering · New: Direct messages between members, behind a feature flag

Members can start a Hub-only direct message from a profile's Message button, switched off for everyone until it is rolled out.

These conversations stay in the Hub and nothing goes to Slack. They are private and restricted, so staff can see that one exists but not its text. The chat_dms feature decides who can start one. It becomes a product entry when it is on for everyone.

## 2026-11-02 · Fixed: Events on your calendar show at the right time

One-day events you add to your own calendar now show their real start and end time instead of sitting all day. Longer events, like retreats, stay all day.

## 2026-11-02 · Improved: Check in or out at any time during a prickle

You can check in until a prickle ends, and the running prickle in your list now has a Check out button. You get a check-out message a few minutes before the end, and you do not need a writing goal to use either.

## 2026-11-02 · New: Turn down moving images and motion

In Settings, Preferences, choose whether the Hub follows your device, always shows animations, or tones them down. With motion reduced, animated emoji stay still.

## 2026-11-02 · New: Sign in with a code from your email

Your sign-in email now includes a one-time code you can type in, so signing in works even if the link opens in the wrong app.

## 2026-11-02 · New: Courses are open to every member

Watch the lessons of the courses you have access to right in the Hub, mark them complete and pick up where you left off.

## 2026-11-01 · Engineering · Improved: Faster CI and repository-based tests

Lint and type checks overlap with tests, and many tests use the in-memory repositories instead of faked database calls.

The notifier, channels, reminders and check-in messages now take repositories instead of database clients, and 176 PostgREST casts were removed by typing the boundary once. pnpm seed:local loads a typed seed profile into the local database.

## 2026-11-01 · New: Gentle reminders are on for every member

Newcomers get a nudge to say hello in the intro channel, and anyone with nothing planned can get a reminder to put a prickle on their calendar. You choose where they arrive, or turn them off.

## 2026-11-01 · New: Events is open to every member

See what is coming up, with a picture on each event and a month-at-a-glance list that shows the time of day.

## 2026-11-01 · New: Hub chat is open to every member

Read and join our Slack conversations from the Hub, reply in threads, react, share files and format your messages. What you write here appears in Slack too.

## 2026-10-31 · Engineering · Improved: More tables behind repositories, and migration safety

Courses, billing, events, books, Zoom, Slack and the people and profile tables moved behind repositories, and a check now fails migrations that drop or rename what live code still uses.

The guard test parses the source and fails on a new direct query. Squawk runs in the Check migrations job, so removals ship in two pull requests: stop using it, then drop it.

## 2026-10-31 · Engineering · New: Course editor for Hub-owned courses, first parts

Staff can create and edit a course in the Hub, add, rename, duplicate, delete and reorder modules and lessons, and play a lesson's video in the builder.

This is staff-only and not visible to members yet. Reorders write a single audit entry with the order before and after. Courses are read and written through CourseRepository and CourseProgressRepository.

## 2026-10-31 · Fixed: Cleaner event names, a working past-events page and tabs that refresh

Cleaner event names, a past-events page that works, and tabs left open across an update reload themselves.

## 2026-10-31 · Improved: Past projects, deleting, and goals that ended

Finished projects are listed apart from the ones you are working on, you can delete a project from its details, and goals that ended unmet no longer show as a standing score.

## 2026-10-31 · Improved: Book genres as tags you can filter by

Genres on the book form are tags, the Book Shelf can be filtered by genre, and search finds books by genre.

## 2026-10-30 · Engineering · Improved: Privacy retention job and usage rollups

A nightly job removes exact IP addresses and browser strings after 90 days, and usage events are rolled up into totals before older ones are removed after 13 months.

The device type is parsed once when a visit is recorded and kept, along with the approximate place. Usage rollups are built from now; nothing reaches 13 months until late 2027. Session Replay for ordinary visits follows consent and the usage-statistics switch, while error-only recording stays on. This backs the promises on [/privacy](/privacy).

## 2026-10-30 · Engineering · Improved: Alerts for crashes, failing page sections and monitors

The team is alerted when a page crashes in the browser, a page section fails or times out, or a synthetic monitor fails.

Section failure alerts link to the error search. Video playback has a nightly end-to-end check and its configuration lives in code, and the error-tracking organization settings are now code too.

## 2026-10-30 · Improved: A clearer privacy page, and a switch for usage statistics

The privacy page opens with a short summary and can be read without signing in. A switch lets you stop the Hub recording how you use it, and removes what was already recorded about you.

## 2026-10-30 · Fixed: Prickle and event descriptions keep their formatting

Descriptions imported from the calendar now keep bold, italic, links, bullet lists, paragraph breaks and dividing lines instead of running together.

## 2026-10-30 · New: Choose how the side menu behaves

A button in the header lets you keep the side menu open, tuck it away until you point at it, or close it. The Hub remembers your choice.

## 2026-10-29 · New: Book covers at any size, from your own images

Upload a book cover at any size, pick it again from your own images and adjust its crop. We also offer a download in the size Amazon asks for, when your image is large enough.

## 2026-10-28 · Engineering · Improved: Google Calendar syncs from push notifications

The calendar sync opens and renews its push channel on its own and syncs only what changed.

Deletions outside the watched window are caught, and the admin calendar refreshes itself when the sync changes prickles. See CalendarSyncStateRepository in lib/data/calendar-sync-state.ts.

## 2026-10-27 · Improved: A help menu in the top bar

The help icon is now a menu with Hedgie Help and Send feedback.

## 2026-10-27 · Improved: Search finds the names people go by

Searching for a member also finds other names they go by, prickle search finds guest speakers, and hosts and attendees show the name people go by.

## 2026-10-25 · Improved: Clearer navigation and a footer

The sidebar now separates Community, where you take part, from Explore, where you browse, and the My prefix is gone from your own pages.

## 2026-10-24 · Engineering · Improved: Typed Supabase clients and stale-type check

Every Supabase client is typed with the generated Database, and CI fails when the generated types are stale.

pnpm types:gen regenerates lib/data/database.types.ts and pnpm types:check runs in CI.

## 2026-10-24 · Fixed: Week calendars scroll on phones

On a phone you can now scroll sideways to Thursday through Saturday on week calendars instead of having them cut off.

## 2026-10-24 · Improved: Getting started asks for your Zoom name

The tour explains that prickles are counted by the name Zoom shows, and refuses a name another member already uses.

## 2026-10-24 · New: Hedgie Help

Hedgie Help has articles on joining a prickle, planning your month, becoming a host, starting a pop-up prickle and running a prickle.

## 2026-10-24 · Improved: Check-ins with mood scales and the Feeling Wheel

Check-ins now use two labeled mood scales and an optional Feeling Wheel, and check-out asks whether you got what you came for.

## 2026-10-23 · Engineering · New: Data access layer with repositories

Tables are queried through repositories with an in-memory twin for tests, starting with attendance.

lib/data holds an interface, a Supabase class and an in-memory class per aggregate, and tests/lib/data-access-layer.test.ts guards against new direct queries.

## 2026-10-23 · Engineering · New: Demo harness and help screenshots

A separate demo stack with Playwright scenes produces the screenshots used in Hedgie Help.

Every scene also runs page checks (accessibility, overflow, console), and screenshots are published before deploy. See docs/DEMO_AND_HELP.md.

## 2026-10-23 · Engineering · Improved: Short prefixed ids for Tier 1 tables

Members, prickles and other visible records moved from uuids to readable prefixed ids.

new_id(prefix) generates ids like mbr_ and prkl_, and new tables follow the same rule. Links to members and prickles use the new ids. See docs/SHORT_IDS_PLAN.md.

## 2026-10-22 · Improved: Wheel of Wonder waits for you

Spinning the Wheel now only picks a match; the chat and icebreaker start when you click Message on Slack.

## 2026-10-22 · New: Show a second time zone beside prickle times

Settings has an option to show a second time zone, such as Eastern, beside the prickle times in your own.

## 2026-10-22 · New: Hover cards for members

Point at a member's name or photo in chat or on Streaks to see their profile at a glance.

## 2026-10-21 · Engineering · Improved: pnpm, auto-merge, docs-only skips and container queries

The repo moved to pnpm, new PRs auto-merge on green, docs-only changes skip tests and deploy, and layouts use named container queries.

Named container sizes live in tailwind.config.ts. A production tag marks what is deployed. Migration order is checked in pre-commit and CI.

## 2026-10-20 · Engineering · New: Usage analytics with a tracking plan

Only declared events are stored, with funnels and a usage explorer for admins.

Events are declared in lib/analytics/events.ts and funnels in lib/analytics/funnels.ts. Members can leave usage statistics from /privacy. See docs/ANALYTICS.md.

## 2026-10-20 · Fixed: Cleaner previews for Hub links

A Hub link shared in Slack and elsewhere now shows a single centered picture instead of an empty or cropped image.

## 2026-10-20 · Improved: Connect Slack in Getting started

Getting started has a Connect Slack step. Once connected, reading a conversation in Slack or in the Hub marks it as read in both places.

## 2026-10-20 · New: Choose your display name

Settings now says which name the community sees, and you can pick one of your pen names or write your own as your display name.

## 2026-10-19 · New: On air light

A light in the header shows when the prickle room has people in it and how to join.

## 2026-10-18 · Improved: Join details for the prickle room

The check-in window, the Slack check-in message and your calendar feed now carry the prickle room's Zoom link, meeting ID and passcode.

## 2026-10-18 · Improved: Clearer time zone settings

The auto-detect option is gone, your current location is always one click away, and the time zone prompt no longer pops up after you pick a zone yourself.

## 2026-10-15 · Engineering · New: Big Sisters program, behind a preview flag

Matching, volunteers, introductions and a Big Sisters page were built behind a preview flag that is not on for everyone.

New members would get a big sister for their first 30 days, with staff choosing the match and arrival dates and trial outcomes derived from membership data. Not yet a general product update; add a product entry when the flag goes on. See docs/BIG_SISTERS.md.

## 2026-10-15 · Improved: A kinder nudge when a streak lapses

The sad broken-heart badge on upcoming prickles is now a seedling that invites you to start a new streak.

## 2026-10-15 · Improved: Getting started: steps for newcomers

The Getting started tour now has steps for saying hello, scheduling your first prickle and syncing your calendar, and it is on for everyone.

## 2026-10-15 · Improved: Add a prickle to your calendar from the Upcoming list

Each prickle in My Prickles, Upcoming has a calendar icon, so you no longer have to open it first.

## 2026-10-15 · New: See who is coming to upcoming prickles

An upcoming prickle now shows who is planning to be there, and you can choose not to be listed.

## 2026-10-15 · New: Search everything from the header

Search the Hub from the header to find members, prickles, events, pages and each settings section, with filters you can type.

## 2026-10-14 · Engineering · New: Test coverage reporting

Coverage is measured, API tests run in-process so route coverage counts, and new code must meet a floor.

v8 coverage with area floors; API tests call route handlers in-process; a required Coverage report check gates patches.

## 2026-10-12 · Improved: Instagram on your profile

The Instagram field in Settings is now a link like Facebook and X, and it shows the handle your profile really links to.

## 2026-10-10 · New: Get notifications by email

You can now choose email for any kind of Hub message, and every email has an unsubscribe link.

## 2026-10-09 · Engineering · New: Chat mirror tables and live updates

A mirror of Slack conversations is projected from Bronze and updated live over Realtime, with posting back to Slack through an outbox.

Row-level security gates content separately from channel metadata. Posts from the Hub go to Slack through an outbox with retries, and are credited to their author in activity and Wheel of Wonder. See docs/SLACK_BRIDGED_CHAT.md and the Hub chat product entry.

## 2026-10-07 · Engineering · Improved: Richer Slack capture with soft deletes

Group DMs, channel membership history, custom emoji and files are captured, deletions are marked rather than removed, and Slack message content is service role only.

Slack Bronze tables use a deleted_at column for removed messages and reactions, and aging out of the import window is never treated as deletion. Message text is readable only with the service role, admins read metadata through a view, and restricted channels are managed by admins. Activities rebuild one week per call to stay inside the statement timeout.

## 2026-10-06 · Engineering · New: Audit log and central Activity Log

Admin changes and member actions are recorded in one audit log with readable rows and per-record history.

The Activity Log page is admin only. The audit log records the net effect of a transaction rather than every intermediate write, and has a Hide system toggle. See docs/ACTIVITY_AND_AUDIT_LOG.md.

## 2026-10-05 · Fixed: Fractions, check-out links and simpler check-in options

Fractional amounts, check-out links and a lighter set of check-in options.

## 2026-10-04 · Improved: Check in and out from your attendance history

Attendance History now has check-in and check-out buttons for each prickle, and Find a Prickle always gives you something to consider.

## 2026-10-03 · Engineering · New: Notification framework with per-kind channels

Automatic messages go through one framework with per-kind, per-channel settings for each member.

Each kind of message is registered in lib/notifications/registry.ts and sent through createNotifier in lib/notifications/notify.ts, which honors member opt-outs. Delivery adapters live in lib/channels/ (Slack, then in-app and email). A message can be marked time sensitive until a given time, and each channel decides what that means. Admin Test Notifications sends every kind on every channel. Related product entries: check-in and check-out messages, notifications inside the Hub, and email notifications.

## 2026-10-03 · Fixed: Fixes to sign-in, notification settings and the dashboard

A handful of fixes to sign-in, notification settings and the dashboard.

## 2026-10-03 · New: Notifications inside the Hub

A bell in the header and a notifications inbox keep your check-ins and other messages in the Hub, with a banner for anything time sensitive.

## 2026-10-03 · New: A Getting started tour for new members

A checklist walks new members through setting up their details, introducing themselves, setting a writing goal and finding a prickle.

## 2026-10-03 · New: Slack reminders to check in before a prickle and check out after

Billie Bot, our Slack helper, messages you shortly before a prickle to ask how you are feeling, and afterwards to ask how it went. You choose whether you get these, and where.

## 2026-10-02 · Engineering · Improved: Slack app manifest pushed from CI

The Slack app configuration is now code, pushed after each production deploy when it changes.

slack-app-manifest.yml is the source of truth and scripts/slack-manifest.ts pushes it after the production deploy, and only when it has changed.

## 2026-10-02 · Engineering · Improved: Config split between app.config.ts and layered env files

Shared deployment config moved into a committed app config, and secrets are layered across shared, preview and production env files.

Values that are the same everywhere live in app.config.ts and are read through lib/config.ts. Secrets use .env.shared with .env.preview and .env.prod overrides, synced by the env:sync scripts. Analytics tracking is production only, and Sentry events are tagged by environment.

## 2026-10-02 · Improved: Link your writing progress to the prickle you wrote in

When you log progress you can say which prickle it was during, and your dashboard reminds you about writing prickles you have not logged.

## 2026-10-02 · New: Say how you feel before and after a prickle

Tell us how you are feeling and what you need before a prickle, and how it went afterwards. The Prickle Picker can use your answers to suggest prickles.

## 2026-09-29 · New: Sign in to the Hub from Slack

Open the Hedgie Hub straight from Slack, without waiting for an email link.

## 2026-09-28 · Improved: Writing goals: titles, profile visibility and clearer status

Goals can have a title and description, and you choose whether each shows on your profile. Finished goals now say Achieved or Ended instead of Behind pace.

## 2026-09-28 · New: Member directory, Ask me about topics and private notes

Search the Hedgies in the new Members page, share what you love to talk about on your profile, and jot private notes about people you meet.

## 2026-09-27 · New: Your prickles in your own calendar, and commitments across several slots

Subscribe to a private calendar feed of the prickles you host, commit to or add by hand, and make a commitment that covers more than one weekly slot.
