# Changelog

<!-- Generated from lib/changelog/entries.ts by `pnpm changelog:generate`. Edit the entries, not this file. -->

What's new and fixed in the Hedgie Hub, newest first.

## 2026-11-06 · Improved: Your most-used feelings come first when you check in

The feelings you name most often now sit at the top of the feeling question, so naming how you feel takes one tap instead of a search through the whole Feeling Wheel.

## 2026-11-06 · Improved: The Members page finds the names people go by

Search on the Members page now also finds a member by a nickname or pen name, and says so with a line under their name.

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

## 2026-11-02 · Major · New: Courses in the Hub

Watch your course lessons right in the Hub, mark them complete and pick up where you left off.

## 2026-11-01 · Engineering · Improved: Faster CI and repository-based tests

Lint and type checks overlap with tests, and many tests use the in-memory repositories instead of faked database calls.

The notifier, channels, reminders and check-in messages now take repositories instead of database clients, and 176 PostgREST casts were removed by typing the boundary once. pnpm seed:local loads a typed seed profile into the local database.

## 2026-11-01 · New: Gentle reminders to say hello and to plan a prickle

Newcomers get a nudge to say hello in the intro channel, and anyone with nothing planned can get a reminder to put a prickle on their calendar. You choose where they arrive, or turn them off.

## 2026-11-01 · New: Events in the Hub

See what is coming up, with a picture on each event and a month-at-a-glance list that shows the time of day.

## 2026-11-01 · Major · New: Hub Chat: our Slack conversations, in the Hub

Read and join our Slack conversations from the Hub, reply in threads, react, share files and format your messages. What you write here appears in Slack too.

## 2026-10-31 · Engineering · Improved: More tables behind repositories, and migration safety

Courses, billing, events, books, Zoom, Slack and the people and profile tables moved behind repositories, and a check now fails migrations that drop or rename what live code still uses.

The guard test parses the source and fails on a new direct query. Squawk runs in the Check migrations job, so removals ship in two pull requests: stop using it, then drop it.

## 2026-10-31 · Engineering · New: Course editor for Hub-owned courses, first parts

Staff can create and edit a course in the Hub, add, rename, duplicate, delete and reorder modules and lessons, and play a lesson's video in the builder.

This is staff-only and not visible to members yet. Reorders write a single audit entry with the order before and after. Courses are read and written through CourseRepository and CourseProgressRepository.

## 2026-10-31 · Fixed: Cleaner event names, a working past-events page and tabs that refresh

Cleaner event names, a past-events page that works, and tabs left open across an update reload themselves.

## 2026-10-31 · Improved: Set-aside projects, deleting, and goals that ended

Projects you have set aside are listed apart from the ones you are working on, you can delete a project from its details, and goals that ended unmet no longer show as a standing score.

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

The search box in the top bar also finds the other names a member goes by and the guest speaker of a prickle, and hosts and attendees show the name people go by.

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

Row-level security gates content separately from channel metadata. Posts from the Hub go to Slack through an outbox with retries, and are credited to their author in activity and Wheel of Wonder. See docs/SLACK_BRIDGED_CHAT.md and the Hub Chat product entry.

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

## 2026-09-28 · New: Settings: your profile, names, time zone and look

Make your profile yours, choose a light or dark look, set your time zone and manage where you are signed in.

## 2026-09-28 · New: Wheel of Wonder: meet a Hedgie who is here right now

Give the wheel a spin and it picks a Hedgie who is online right now, leaning toward people who could use a new connection.

## 2026-09-28 · New: Your books and awards, and a Bookshelf for the whole community

Add your published books and awards to your page, and browse the Hedgie Bookshelf to find what other members have published.

## 2026-09-28 · New: My Writing: projects, goals and progress

Keep your projects in one place, set goals, log how much you wrote, and watch your progress on charts.

## 2026-09-28 · New: Host prickles and plan your hosting month

If you host prickles, a Hosting tab lets you plan which weekly prickle times you take and see how your hosting is going.

## 2026-09-28 · New: Streaks: celebrate showing up week after week

See how many weeks in a row you have joined a prickle, your best run so far, and the streaks you keep with a particular prickle or with another Hedgie.

## 2026-09-28 · New: Your attendance history

Look back at the prickles you have attended, month by month on a calendar or as a list you can sort.

## 2026-09-28 · New: Browse every prickle, or let the Hub help you find one

My Prickles has tabs for what is coming up, every prickle on the schedule, and a short guide that helps you pick a prickle that suits you.

## 2026-09-28 · New: A dashboard that shows what is coming up

Open the Hub and see the prickles coming up in your next seven days, plus the writing goals you have starred.

## 2026-09-27 · New: Your prickles in your own calendar, and commitments across several slots

Subscribe to a private calendar feed of the prickles you host, commit to or add by hand, and make a commitment that covers more than one weekly slot.

## 2026-09-27 · Engineering · New: Commitments cover several slots and rank in Upcoming

A commitment can now hold several recurring slots, chosen from the All Prickles table or calendar, and committed prickles rank as a personal signal in Upcoming.

On 2026-09-26 an upcoming prickle that is a week of the viewer's active commitment got its own tier just under hosting and above streaks (priorities became the named `PRIORITY` constants), using `computeCommitmentProgress` in `lib/commitments.ts`. Migration `commitment_slots` (2026-09-27, listed because it landed with the 2026-09-26 batch) moves the slot into `prickle_commitment_slots` (one or more per commitment), adds an atomic `create_prickle_commitment` function, and replaces the one-active-commitment-per-slot index with an overlap trigger that allows renewals. RLS follows the `current_member_id()` and `is_admin()` convention, covered by `tests/api/commitments/rls.test.ts`.

## 2026-09-26 · Engineering · New: Shared table sorting and pagination, All Members paged in SQL

One hook now sorts and auto-paginates tables, and the admin members list pages in the database instead of loading everyone.

`lib/pagination.ts` parses page, page size (capped at 100) and whitelisted sort columns, and decides where paging happens (server-side for sources that can pass 1000 rows, client-side for bounded tables, none for a single 50-row page). `useDataTable` combines sorting with auto-pagination above 50 rows, `useServerDataTable` is the URL-backed server mode, and `DataTablePager` renders the footer only when needed; about 20 existing tables were migrated and empties now sort as a true reversal. `/admin/members` used to load every member (one unpaginated select, silently capped at 1000), the whole attendance history and 30 days of activity, and compute in JS; `admin_members_page` and `admin_member_filter_counts` SQL functions now do it.

## 2026-09-26 · Engineering · New: Admin routes protected in the proxy and next to the data

Admin pages and actions are checked at three layers, and the access token carries a role hint so the proxy needs no database read.

Following the Next.js authentication guide, `proxy.ts` makes an optimistic role check for `/admin`, `requireAdminPage()` runs in the admin layout and every admin page (layouts do not stop a page segment rendering), and each admin server action calls `requireAdminAction()` (the merge-fix dismiss actions previously accepted any signed-in user). Signed-in non-admins go to a terminal `/no-access` page, which avoids a `/admin` and `/dashboard` redirect loop for users without a member record. Conformance tests fail if an admin page or action skips its check.

Migration `add_role_to_access_token` adds a Supabase custom access token hook, `custom_access_token_hook`, that writes `user_profiles.role` into an `app_role` claim (not `role`, which PostgREST uses as the database role). The proxy reads it from the already verified token; the claim is only as fresh as the token, so the real authorization still reads `user_profiles`. The hook swallows lookup errors and omits the claim rather than blocking sign-in. On 2026-09-27 CI began pushing `supabase/config.toml` after migrations, so the hook function always exists before config that references it. A pgTAP test covers the hook.

## 2026-09-26 · Engineering · Fixed: Row-level security audit: writes, reads and self-promotion closed

A policy audit closed gaps where any signed-in member could write to admin tables, read other members' private rows, or make themselves an admin.

Self-promotion: the own-profile update policy plus table-wide UPDATE let a member change their own `user_profiles.role`. A column-level revoke would also have blocked admins, who change roles from their own session, so a BEFORE UPDATE trigger (`guard_user_profile_privileged_columns`) rejects changes to role, email or id unless the caller is an admin or a privileged database role, with a test in `tests/api/admin/user-profiles-role-escalation.test.ts`.

Writes: an audit of `pg_policies` across `public` and `bronze` found about 45 tables whose write policies only checked for an authenticated user. They became admin-only (`is_admin()`) or owner-or-admin (`current_member_id()`), including a trigger limiting a member's own `members` update to name and birthday; event, attendee and photo writes got their own migration and RLS test. Reads: `member_directory`, a trigger-synced view of public profile fields, replaced direct reads of other members' rows; `members` is now readable only for one's own row (or by admins), bronze tables and admin note tables are admin-read, and `member_activities` reads are own-rows. App queries moved to `member_directory` and computed relationships (`prickle_host`, `attendance_member`), and member pickers stopped sending every member's email to the browser. The search path was pinned and EXECUTE restricted on the `upsert_stripe_*` functions, which were dropped on 2026-09-27.

## 2026-09-26 · Engineering · Improved: Hosting eligibility counted from first join and enforced on the server

The one-full-month rule before hosting now counts from a member's first join, and ineligible sign-ups are refused server-side.

Tenure counts from `first_joined_at` (falling back to `most_recent_joined_at`), so rejoiners after a cancel or hiatus do not wait again, which removed the hiatus-history query. `requestToHost` rejects ineligible members with a shared `hostEligibilityMessage` and no insert; members who already hosted or have a confirmed schedule are exempt. The admin Add Schedule form looks up the host email on blur and warns before saving; `GET /api/members?email=` returns `host_eligibility` for exact lookups. The profile Hosting card moved to a SQL aggregate, `get_hosted_prickle_attendance`, instead of paging every attendee row.

## 2026-09-25 · Engineering · New: Member profile overrides and TrackBear import

Members' own bio and social links are stored in the Hub and win over Kajabi, and writing projects can be imported from a TrackBear export.

TrackBear import (2026-09-25): members upload TrackBear's data export on the Projects page (`/api/projects/import/trackbear`); projects, progress entries, starting balances, covers, tags and single-project goals are imported, and what Hub cannot represent is listed in the result and `docs/TODO.md`. An `external_id` column unique per member on projects, progress entries and goals makes re-imports idempotent. Export upload was chosen because TrackBear has no OAuth and its API needs a member-made key.

Profile overrides (2026-09-26): Kajabi's API cannot write a customer's public bio or socials, so the Local-layer table `member_profile_overrides` (one row per member, own-row RLS, HTTP(S) and 1000-character bio checks) holds member edits. `/api/process/members` prefers a non-empty override field by field, matching on Kajabi id then email, and members reprocess when it changes. `lib/social-links.ts` validates handles and URLs. Line breaks in bios are preserved on the profile page.

## 2026-09-25 · Engineering · Improved: env-vars.config.ts as the single list of environment variables

Three sync scripts each kept their own hardcoded variable list. They now read one manifest.

`sync-to-vercel`, `sync-to-github` and `sync-vault-secrets` were bash scripts with separate lists that drifted apart, so some variables were missing from `.env.example`. `env-vars.config.ts` now declares each variable's destinations (Vercel environments, GitHub secret or variable, Supabase Vault) and whether it is secret; the scripts were rewritten in TypeScript on top of it, including the missing-value validation. `.env.example` and the env files were regrouped by system, and a secret rotation runbook was added.

The manifest records an incident lesson that the Vercel sync enforces: variables always sync with `--type config`, because Vercel's default sensitive type can never be read back (even by `vercel pull`) and a sensitive `NEXT_PUBLIC_*` value is inlined into the client bundle as a placeholder string. A bug where `npx` resolved the wrong `vercel` binary because of PATH shadowing was fixed too.

## 2026-09-24 · Engineering · New: My Prickles page and navigation built around intentions

The member navigation collapsed from about ten items to Home, My Burrow and Community, with a My Prickles page composed of tabs, including a full recurring schedule.

The nav was regrouped (My Writing, My Prickles and Streaks under My Burrow; Wheel of Wonder, Bookshelf and Events under Community; profile in the account menu) and added a My Prickles page composing attendance history, the prickle picker and hosting as tabs. The dashboard's upcoming-prickle ranking moved to `lib/upcoming-prickles.ts` so both pages share it. It also fixed the member layout and settings page resolving feature flags for admins only, which had hidden flagged pages from real members. On 2026-09-26 the standalone `/hosting`, `/prickle-picker` and `/calendar` routes were removed and their links pointed at the tabs.

An All Prickles tab (`lib/prickle-schedule.ts`) groups every recurring slot by type, day of week and hour, shows who hosts next and a historical average attendance, as a table localized to the viewer's zone and later a calendar that also shows past prickles. The Projects page became My Writing with Projects, Books and Awards tabs (2026-09-26).

## 2026-09-23 · Engineering · Improved: Upgrade to Next.js 16 and Turbopack production builds

The app moved from Next.js 15 to 16.3.6, with Turbopack as the production compiler.

The upgrade (PR 23) used the official codemods, then manual follow-ups: `middleware.ts` became `proxy.ts`; the removed `eslint.ignoreDuringBuilds` option was dropped; an explicit lint step was added to `ci.yml` because `next build` no longer lints; the React Compiler hook rules newly on in `eslint-config-next` were set to warn; and about 15 TypeScript errors that the stricter build typecheck surfaced were fixed. Two codemod side effects were reverted as out of scope (an `instant = false` opt-out on 69 files and an eslint 10 bump).

`package.json`'s `build` then switched to `next build --turbopack` (same day). The investigation behind it found Turbopack's shared first-load JS about 38 kB larger on every route, and two routes (`/admin` and `/projects/[id]`) carrying an extra 90-100 kB because it inlines a copy of recharts' `AreaChart` into each route chunk where webpack shares one. That was accepted as bounded to two authenticated routes. A Next 16 follow-up plan was recorded in `docs/TODO.md`.

## 2026-09-23 · Engineering · Improved: Faster CI and workarounds for Docker registry rate limits

CI start-up work now overlaps the build and pulls images from Docker Hub, cutting the database job from about six minutes to about two and a half.

`supabase start` is backgrounded and awaited after the production build, and the CI build used Turbopack. Measured on the job "Test (db) and build": 6m4s before, 2m29s after (some of the drop was runner variance, since the test step also got faster). Pulls from ghcr.io hit rate limits, so CI first authenticated, then retried with backoff, and finally forced the Supabase CLI to pull its local images from Docker Hub via `SUPABASE_INTERNAL_IMAGE_REGISTRY` set at step level. Checkout and setup-node actions moved to v5 and runners were pinned to ubuntu-24.04 ahead of the `ubuntu-latest` migration (a TODO to revisit the pin was added). The Stripe API version pin was updated to match SDK 22.6.2.

## 2026-09-23 · Engineering · New: CI pipeline: test, push migrations, then deploy

Merges to main now run tests, apply database migrations and only then deploy, so new code never goes live before its schema.

`.github/workflows/ci.yml` (merged 2026-09-22) starts a local Supabase stack, builds, starts the app and runs the unit and database suites, then pushes pending migrations to production on main. `docs/CI_MIGRATION_ORDERING.md` weighs two options: leave Vercel's own git deploy running (a minutes-long window where code can hit a table that does not exist yet, as an earlier segments page outage did) or gate the deploy on CI. On 2026-09-23 Option B was adopted and Vercel's auto-deploy on main was switched off in `vercel.json`.

On 2026-09-24 the deploy hook (which triggers a separate remote build and reports success the moment the hook is accepted) was replaced by `vercel pull`, `vercel build --prod` and `vercel deploy --prebuilt --prod`, so the exact commit that passed tests is the one deployed and a bad build fails the job. `.next/cache` is restored with `actions/cache`. Preview deployments still come from Vercel's git integration.

## 2026-09-22 · Engineering · New: Health check endpoint, Sentry and Checkly uptime monitoring

A public health endpoint, error reporting and uptime plus certificate checks now watch the production site.

`/api/health` queries Supabase so an external monitor learns the database is reachable, not just that Next.js answers. Checkly monitors are code in `__checks__/` (an uptime check on the health route and an SSL check with a 14-day expiry warning, both every 10 minutes from two regions) with `checkly.config.ts`, deployed by `.github/workflows/checkly.yml`: `checkly test` on pull requests and `checkly deploy` on pushes to main, filtered to paths that affect the checks. Sentry DSNs are synced to every environment and the build auth token to production only; Google Analytics and the integration links doc were added the same day.

On 2026-09-23 Sentry's `includeLocalVariables` was turned off after traces showed the Node inspector it attaches added about 800 ms to every server render on Vercel (a login render went from roughly 850 ms to 40 ms). On 2026-09-25 the health route gained Server-Timing output and an optional `?timing=1` breakdown (DNS, TCP, TLS, warm repeat query) to chase slow Supabase calls after idle periods.

## 2026-09-18 · Engineering · Improved: Supabase auth emails sent through Resend, config as code

Production auth email settings are declared in config.toml and applied with supabase config push instead of a custom sync script.

A `[remotes.prod]` block in `supabase/config.toml` now holds production SMTP (Resend) and the email template settings, replacing `scripts/sync-email-templates.ts`. `npm run config:diff` and `config:push` were added, the email footers got a support line sent from a no-reply sender, the deprecated `[inbucket]` section was renamed `[local_smtp]`, and the domain and DNS plan was written into `docs/TODO.md`. A note that config push leaves undeclared settings unchanged was corrected on 2026-09-18.

## 2026-09-15 · Engineering · New: member_awards table and self-reported award flow

Members can record outside awards and competition wins, modelled on the bookshelf self-report flow.

Migration `create_member_awards` plus a server action (`app/(member)/awards/actions.ts`), `AwardFormModal` and a panel on the Projects page, with validation in `lib/awardValidation.ts`. Each win posts to a staff Slack channel through `notifyStaffNewAward` in `lib/slack.ts`, gated on a channel env var that was added to the Vercel sync script and `.env.example`. Submission tracking, win-rate stats and a deadline list were deferred to `docs/TODO.md`.

## 2026-09-14 · Engineering · Fixed: members.user_id becomes the durable login link

A member's login link was silently wiped on every Kajabi reprocess. It is now preserved and used first when working out who is signed in.

`reprocess_members_atomic` overwrote `members.user_id` unconditionally, and the payload only carried a value through `staff.user_id`, so the link was lost each run. Migration `retire_staff_user_id_add_member_id` adds `staff.member_id` as a maintained foreign key, retires `staff.user_id`, and makes the function keep an existing `members.user_id`. `getEffectiveIdentity` (`lib/sudo.ts`) now resolves by `user_id` first, which survives email changes, and falls back to email for older accounts.

Before that (2026-09-08) the admin Users page gained a Member picker independent of the Staff picker, since most people given login access are paying members rather than staff. Also on 2026-09-14: an editable legal name pushed to Kajabi's contact record so the next full reprocess does not overwrite it, and a default pen name (`member_display_name` migration, `lib/member-display-name.ts`).

## 2026-09-09 · Engineering · New: Activity log for attendance, outreach and logins

The member activity table now mirrors prickle attendance, outreach touches and sign-ins, so one table can answer what a member has been doing.

Migrations extend `member_activities` and add `reprocess`-safe mirrors: prickle attendance is mirrored into it atomically (`mirror_prickle_attendance_to_activities`), outreach touches are backfilled, `members.user_id` is backfilled, and a dedup index plus `get_recent_login_sessions` support login events (`lib/processing/login-events.ts`, `/api/reconcile/logins`, scheduled in `vercel.json`).

`lib/member-engagement.ts` was rewritten to read from the activity table instead of recomputing from each source. The design is described in `docs/ACTIVITY_AND_AUDIT_LOG.md`. Attendance reprocessability and Slack reprocess tests were extended for the mirror.

## 2026-09-08 · Engineering · Improved: One data hygiene dashboard with fuzzy duplicate matching

Reconciliation and data hygiene were merged into one admin dashboard, and duplicate detection now scores fuzzy name matches.

Reconciliation duplicated two hygiene checks (Slack and Zoom orphans) with different scoping, and Merge and Fix claimed fuzzy duplicate detection but only matched exactly. The per-member reconciliation table moved into `/admin/hygiene`, the duplicated read-only lists became links to the real tools, and the dashboard was reorganized into Pipeline, Identity, Duplicate and Completeness sections.

`lib/text-similarity.ts` and `lib/member-duplicates.ts` add confidence-scored fuzzy name matching; Unmatched Zoom Names gets ranked suggestions (shared with prickle detail pages); the External Conflicts tile shows a real count (`lib/external-conflicts.ts`). Slackbot was excluded from the Slack user queries on 2026-09-14.

## 2026-09-05 · Engineering · Improved: Membership timeline as one non-overlapping segment list

The admin membership timeline is now built by a sweep-line that merges stints, hiatuses, programs and overrides, and member status is recomputed whenever a hiatus changes.

Hiatuses happen inside membership stints, not after them, so the old flat list of raw rows from each source put misleading captions under unrelated rows. `lib/membership-timeline.ts` now merges stints, hiatuses, program enrollments and status overrides into chronological segments with one rule: hiatus wins, then any active source, then a gap. Concurrent programs and overrides show as secondary tags instead of extra rows.

Follow-ups the same day: `lib/member-status.ts` recomputes and saves one member's status right after any hiatus mutation (before this, only the full `/api/process/members` run did, so the badge went stale), hiatus return dates became choosable and hiatus rows editable, and DATE columns (`member_hiatus_history`, cohort dates) are parsed with `parseDateOnly` so they no longer display a day early in zones behind UTC. A `Starts At` field was added to overrides, and its start/expiry got the same off-by-one fix on 2026-09-06.

## 2026-09-04 · Engineering · New: Program cohorts, enrollments and Kajabi purchase matching

Programs such as the 180 Program became real data (programs, cohorts, enrollments) with admin pages, and staff can enroll people from a reviewed list of matching Kajabi purchases.

Migration `create_program_cohort_tracking` adds programs, cohorts (with start and expiry dates) and enrollments, with admin pages under `/admin/programs` and routes under `/api/admin/program-cohorts`, `program-enrollments` and `programs`. `reprocess_members_atomic` was rebuilt to apply active enrollments: an active cohort now yields `active` status, ordered before hiatus so an active hiatus still wins. Two bugs found verifying that on a local stack were fixed (step ordering, and `EXTRACT(EPOCH ...)` applied to a DATE subtraction, which Postgres returns as an integer).

On 2026-09-05 a "Find Kajabi matches" action was added: `lib/kajabi-cohort-matching.ts` (later split into a pure, DB-free function with a regression test) lists members whose purchases of the program's configured offers have a transaction date or access-grant date inside the cohort window. It feeds a staff-reviewed bulk enroll rather than blind enrollment, because access dates can lag transaction dates by more than a week. Offer names are picked from the live Kajabi offer catalog, and the email-alias resolution that several matchers duplicated moved to `lib/email-aliases.ts`.

## 2026-09-04 · Engineering · New: Distinct status override types and payment-legitimacy checks

Membership status overrides gained separate types for the 180 Program and for people who pay Stripe directly, plus a check for Kajabi access with no payment behind it.

`member_status_overrides` already had `gift` (free membership for a window). Two cases were being forced into it, which would have mislabeled real revenue as comps in any later comp reporting. A `180_program` type (one-time cohort purchase, six months included, then `cancelled` rather than `lead` if the window lapses) and a `direct_stripe` type (a paying customer on a subscription our Kajabi sync cannot see) were added as their own `override_type` values, with a migration that moved the one existing `gift` row that stood in for the second case.

The reconciliation page auto-detects `direct_stripe` candidates and, as the mirror image, flags Kajabi purchases on membership offers that have no transaction or a zero amount (`/api/analyze/kajabi-grants`). A multi-customer false positive in the Kajabi/Stripe mismatch check was fixed the same day. The grants check found no matches in production when it was built; it exists so a future manual grant does not become a new invisible category.

## 2026-09-02 · Engineering · Fixed: Trial conversion check uses Stripe's cancel time

Abandoned trials were being counted as real, billed memberships. The check now trusts Stripe for when a customer actually canceled.

`isRealMembershipStint` decided whether a Kajabi purchase was a real stint or an abandoned trial by checking that Kajabi's `deactivated_at` came after the trial end. Kajabi keeps a mid-trial cancellation "active" until the trial's natural end and only then sets `deactivated_at`, so almost every mid-trial cancel passed the check.

The check now prefers the matching Stripe subscription's `canceled_at`, which records the real cancel moment, and falls back to `deactivated_at` only when there is no Stripe match. Checked against production data at the time: 16 purchases across 16 members moved from "real stint" to "abandoned trial", and two of them explained unexplained multi-hundred-day gaps against the manually kept anniversary list.

## 2026-08-31 · Engineering · New: Badge system with automated badges and a bookshelf import

A generic badge model landed, with some badges computed and others awarded by admins.

`badge_types`, `badge_levels` and an append-only `member_badges` log (level derived from award count) are managed at `/admin/badges`. Prickle milestones and Founding Hedgie are computed on the fly from attendance and tenure, never stored; Hostess and Published Author were later automated, with a Hedgie Bookshelf. Admins can see everyone who earned a badge, and retreat badge types were added. The member Profile page was renamed Settings the same day.

## 2026-08-29 · Engineering · Improved: Member tenure derived from billing history with join date overrides

First join date, time as a member and hiatus handling are computed from billing data, replacing a manual spreadsheet.

Tenure (first joined, most recent join, active months, excluding hiatus) is computed from Kajabi purchases and hiatus overrides, and drives an admin Hedgieversary page and hiatus touchpoints. Hiatus now reads from `member_status_overrides`, the table reprocessing uses.

Join date is the first real transaction: `buildMembershipStints` uses the matching Stripe subscription's `trial_end` when a real trial existed. Kajabi offers never expose trial length, so on 2026-08-30 trial detection moved to Stripe's `trial_start`/`trial_end` through one shared `isRealMembershipStint`, keyed by canonical email so Kajabi contact merges do not break it. The Stripe import now requests all statuses, since the default omitted cancelled subscriptions. `member_join_date_overrides` handles members from before the 2022 Kajabi migration.

## 2026-08-29 · Engineering · New: Writing projects tracking: projects, entries, goals and habits

The data model and logic for members' writing progress landed in phases.

Phase 0 added member-owned Local layer tables (projects, dated progress entries, goals) with RLS like the schedules tables, `/writing` routes and a dashboard widget. Progress math handles add versus set-total entries and backdating, and target goals show a par-line pace.

Phase 2 made `GoalRow` a union of target and habit goals (streak, longest and typical streak, hit rate) rendered through one `GoalDisplay`, with entry tags, per-project CSV export, a cumulative chart and heatmap, and opt-in display on the member's profile. On 2026-08-31 prickles attended became a goal measure, derived from `prickle_attendance` and anchored to a snapshot of a schedule; re-anchoring archives the old goal and forks a new one.

## 2026-08-28 · Engineering · New: Hosting: member-managed monthly prickle schedules

Hosts can plan their monthly prickle schedule themselves, and admins can review and lock it.

A migration creates the prickle schedule tables with RLS (a member manages only their own rows, admins bypass), and `lib/prickle-schedules.ts` holds the logic. `/hosting` has the member manager, `/admin/hosts` the admin view, and `/api/prickle-schedule-locks` locks a month. Integration tests cover the API, locks and the RLS rules, and a calendar-based bootstrap seeds the first month.

## 2026-08-28 · Engineering · New: Prickle Picker recommender and Wheel of Wonder matching

Two feature-flagged member tools landed: a prickle recommender and a weighted random member match.

`lib/prickle-picker.ts` is a pure scoring engine over historical attendance. `prickle_types` gained `purpose` and `solo_task_friendly`, and `prickle_host_vibes` stores host-tagged vibes. Both are behind the `prickle_picker` feature preview.

Wheel of Wonder (first built as Hedgie Roulette, renamed in code and the `wheel_of_wonder_matches` table the same day) weights candidates toward members with few connections and low recent Slack activity and only offers someone a live Slack presence check says is online. A match counts as a connection only after a real back-and-forth is seen in the Slack webhook, and an admin review page was added.

## 2026-08-27 · Engineering · New: Member dashboard, network view and mobile drawer navigation

The member area gained a dashboard landing page, a network page and a hamburger menu on small screens.

`/dashboard` shows the next seven days of prickles with a highlighted set (hosting, active streak, a streak partner's usual slot) and became the post-login landing page. `/network` draws a radial SVG map of a member's streak connections. `MemberNavigation` swaps the permanent narrow sidebar for a drawer below `md`; the admin navigation got the same on 2026-08-29. Streak week boundaries now use the member's timezone instead of UTC (`lib/streaks.ts`).

## 2026-08-27 · Engineering · New: Access history, session management and force sign-out

Admins can see when a user came back and what they visited, members can end their own other sessions, and admins can force a sign-out.

Middleware inserts an `access_events` row per authenticated request via `after()`, skipping prefetches. `get_access_sessions()` groups events into visits with a 30 minute gap and, from a later migration, joins them to the real `auth.sessions` row through a session id claim (`lib/supabase/session-claims.ts`).

Supabase Auth cannot list or revoke a single session, so `get_my_sessions()` and `revoke_my_session()` are `SECURITY DEFINER` functions scoped to `auth.uid()`, shown in the member profile, and a `revoke_user_sessions` function powers the admin Force sign-out (sudo cannot reach a member's real session). The server clients forward the real User-Agent and forwarded IP to Supabase Auth so sessions show the actual device.

A transient middleware auth-check timeout no longer redirects to /login, since the layouts re-verify the session themselves.

## 2026-08-27 · Engineering · New: Site-wide feedback widget with screenshots

Signed-in users can report a bug or idea from any page, and admins review it and see it in Slack.

`components/FeedbackWidget.tsx` is mounted in the member and admin layouts, captures a viewport screenshot, and posts to `/api/feedback`; admins review items at `/admin/feedback`, where a one-click sudo-as-reporter button and Escape-to-close lightbox were added. The Slack notification uses native file upload and runs inside `after()` so it is not dropped when the function freezes.

## 2026-08-27 · Engineering · New: Data hygiene tools: unmatched Slack users and private channel access

Admins can match Slack accounts to members with suggested candidates and see private channels the Slack app can no longer read.

`/admin/hygiene/unmatched-slack` lists Slack users with no member and offers one-click alias creation. `suggestMemberMatches` in `lib/member-matching.ts` scores name similarity and email local parts, at token level as well as whole string (so a short Slack name is not buried by a long legal name) and requires both names to meet a length floor for substring matches. Active users sort first.

`lib/private-channel-access.ts` flags private channels whose Bronze row was not refreshed in the latest nightly import, as a proxy for the Slack app having lost access. It is detection only, because an app cannot invite itself back. Slack app was also renamed and its manifest synced with the live config, and ERD and sequence diagram docs were rewritten to match the then-current schema.

## 2026-08-27 · Engineering · Fixed: Webhook follow-up work kept alive with after(), Bronze fetches paginated

Background reprocessing and notifications no longer get killed when the response is sent, and member processing reads all Bronze rows.

The calendar and Zoom webhooks and the feedback Slack post started work without awaiting it, which Vercel could freeze once the response went out. They now use `after()` from `next/server`.

`/api/process/members` now paginates its Bronze reads past the 1000-row Supabase limit, with a reprocessability test over more than a page of rows.

## 2026-08-26 · Engineering · New: ESLint flat config and a husky pre-commit hook

Linting and the pre-commit hook are now managed by the project itself rather than a hand-installed script.

`eslint.config.mjs` adds a flat config, and `.husky/pre-commit` replaces `scripts/install-hooks.sh`. Dependabot findings were also reduced by bumping `vercel` and adding package overrides (audit findings from 75 to 24). On 2026-08-26 the same pass gave every page a unique browser tab title through a root title template and per-page metadata.

## 2026-08-26 · Engineering · Improved: Member status lifecycle: lead, active, on hiatus, cancelled

Member status now separates people who never purchased from former members, and manual hiatus overrides survive reprocessing.

`members.status` was `active | inactive | on_hiatus`; `inactive` mixed never-purchased leads with real cancellations, and a hand-set `on_hiatus` was overwritten by the next nightly `reprocess_members_atomic`. The enum became `lead | active | on_hiatus | cancelled`, the previously unused `member_status_overrides` table is applied as a final step inside that function, and a shared `MemberStatusBadge` plus lead/cancelled filter tabs and dashboard counts were added.

A planned `is_trial`/`has_trialed` split was removed the next day because the Kajabi API does not expose trial information; trial detection later moved to Stripe data (see the tenure entry).

## 2026-08-26 · Engineering · Fixed: Slack webhook Bronze writes repaired, plus a daily Slack reconcile job

Real-time Slack messages and reactions had not been stored since the webhook was built; they are now, and a nightly import backstops them.

`processSlackEvent` upserted a `raw_data` column that does not exist (the NOT NULL column is `raw_payload`) and never checked the result, so it logged success and triggered Silver reprocessing on data that was never written. It now uses `raw_payload`, checks every Bronze write and skips reprocessing on failure; webhook tests that had been skipped were enabled, with a regression test for the failure mode.

Slack was the one integration without a reconcile cron. `triggerSlackSync` and `/api/reconcile/slack` (daily in `vercel.json`) call the Slack API import in-process. The window was set to 90 days because Slack's free plan only exposes that much history, so drift older than that would be unrecoverable.

## 2026-08-23 · Engineering · Fixed: Member engagement computed from attendance and Slack activity

Admin member pages now derive last attended, recent counts and risk from real data instead of static seed rows.

`member_metrics` and `member_engagement` were never refreshed, so every member read Never/0/low risk. The shared `lib/member-engagement.ts` now computes last attended, 30-day and total prickle counts (distinct `prickle_id`, as the attendance design requires), an engagement score and a risk level from `prickle_attendance`.

On 2026-08-26 Slack activity from `member_activities` joined the score (last 30 days, capped at 100); risk stays based on prickle recency. A members list bug with `?filter=all` returning Bad Request and tri-state column sorting (`SortableTh`, `useTableSort`) landed alongside.

## 2026-08-05 · Engineering · Fixed: Row level security on 17 exposed tables, and Supabase advisories cleared

Tables that the public API could reach without row level security now require a signed-in user, and the remaining warning-level advisories were addressed.

A migration enabled RLS on 17 tables in the `public` and `bronze` schemas that Supabase flagged as readable and writable with the anon key. Five Slack and subscription tables had policies set in the dashboard without RLS switched on; the others had neither. All got the project's usual authenticated-only policy.

On 2026-08-06 a second migration pinned `search_path` on six functions, moved `pg_trgm` into the `extensions` schema, and restricted a `SECURITY DEFINER` function's execute grant. Two definer functions used by sign-up and the `is_admin()` policies were deliberately left alone to avoid breaking them, and the skipped advisories were documented in `docs/TODO.md`.

## 2026-07-19 · Engineering · New: Slack engagement insights for admins

An admin page shows when Slack is busiest, which channels drive engagement and which have gone quiet.

`/admin/insights/slack-engagement` is backed by `lib/slack-engagement-stats.ts`: a day-and-hour heatmap, per-channel engagement with trend sparklines, and a list of dormant channels that are candidates for archival. It has a unit test file of its own (`tests/lib/slack-engagement-stats.test.ts`).

## 2026-07-07 · Engineering · Fixed: Calendar import removes events deleted from Google Calendar

Deleted calendar events no longer linger in the Bronze layer and turn into ghost prickles.

The calendar sync only upserted, so an event deleted in Google Calendar stayed in `bronze.calendar_events` and was reprocessed into a ghost prickle. A `SECURITY DEFINER` function `delete_stale_calendar_events()` now removes rows in the synced date range whose Google event id is missing from the current response. It refuses to run on an empty id list, so an empty Google response cannot wipe the range, and the import reports a deleted count.

The same week the calendar routes were consolidated: the import route accepts explicit `fromDate`/`toDate`, `import/calendar` became canonical, the `sync/*` namespace was removed in favor of `import/*`, and all Bronze writes use the service role. On 2026-08-06 execute on the delete function was revoked from `anon` and `authenticated`, since only the admin-gated import route calls it.

## 2026-07-06 · Engineering · New: Admin users page: invites, roles, feature previews and linked profiles

Admins can manage portal users in one place: invite, change role, set feature previews, delete, and link a user to a staff record.

`/admin/users` (`app/api/admin/users`) lists auth users with role and enabled feature previews, with inline edits and a delete that blocks self-deletion. A follow-up added a Linked Profiles column: PATCH with `staffId` sets `staff.user_id` and `members.user_id` together, matching the member by email, so no reprocess is needed.

Tests in `tests/api/admin/users.test.ts` cover the auth guards, create/update/delete, feature-flag replace semantics and link/unlink. On 2026-08-27 a resend-invite button for pending users was added.

## 2026-07-06 · Engineering · Fixed: Integration suite made deterministic

Wrong column names, missing required fields and tests that cleaned up each other's rows were fixed.

Several integration tests selected columns that did not exist (`zoom_name`, `created_at_stripe`), omitted NOT NULL fields, or used the wrong member status. Tests that shared far-future date ranges (2099-07) deleted each other's data, so they were moved apart, and a pagination test now compares a differential count instead of a baseline that concurrent tests could change.

## 2026-07-06 · Engineering · New: Admin insight pages: Community Stats and resubscriptions

Two admin analysis pages landed on top of the Silver data: community writing and prickle statistics, and members who cancelled and came back.

Community Stats (first named Fun Stats, renamed throughout the codebase) shows community writing metrics, an analog-clock heatmap of when prickles happen, prickle types by session count, and a date filter with year, quarter and month to date presets.

`/admin/insights/resubscriptions` lists members who cancelled and rejoined, with a monthly cohort chart. The detection logic was extracted into a library function with integration tests, and resolves email aliases and duplicate Kajabi customer ids per email before grouping purchases. The page queries Supabase directly rather than fetching its own API route.

## 2026-07-05 · Engineering · Fixed: Nightly reconcile jobs actually run: GET handlers, cron secret, Kajabi API

The three daily reconcile routes failed on Vercel Cron, and the members one did nothing; both are fixed.

Vercel Cron always calls with GET, but the `/api/reconcile/*` routes only exported POST, so every run answered 405. The shared auth helper (`lib/supabase/api-auth.ts`) also never checked the `CRON_SECRET` bearer token its README described; it now does, and `scripts/sync-to-vercel.sh` syncs the secret to production.

The members job was calling a reprocess of `kajabi_members`, a table with no Silver dependents, so it was a no-op. A new `triggerKajabiSync()` in `lib/processing/trigger.ts` (mirroring the calendar one) makes `/api/reconcile/members` call the Kajabi API sync that already existed, with unit tests for auth, success and error paths.

## 2026-07-03 · Engineering · Fixed: Membership history built only from real membership subscriptions

A member's membership history now ignores one-off purchases and non-membership offers, follows email aliases, and starts from the date Kajabi first created the subscription.

The membership history for a member (`lib/kajabi/membership-history.ts`, extracted as `fetchMembershipHistory` so tests call the real implementation) had been counting non-subscription purchases and non-membership offers. A shared `isMembershipOffer` helper in `lib/membership` now decides what counts, with unit tests, and the query follows every customer id that belongs to a member's alias emails.

The start date uses `created_at_kajabi` rather than `effective_start_at`: Kajabi rewrites `effective_start_at` on each renewal, so it drifts to the latest billing cycle, while `created_at_kajabi` matches the "Started on" date in Kajabi and never changes. On 2026-07-06 the end date followed the same billing-based logic: each subscription ends where the next one starts, and only the latest one falls back to `deactivated_at`.

## 2026-07-02 · Engineering · New: Old email kept as an alias when a Kajabi contact changes address

When a member's email changes in Kajabi, the old address is now remembered as an alias so later imports that still use it resolve to the same member.

`reprocess_members_atomic` matches members by `kajabi_id`. When it sees a matched member whose email differs, a new migration makes it insert the old email as an alias with source `auto_detected`, and redirect any existing aliases that pointed at the old canonical email to the new one, so alias chains stay consistent.

A reprocessability test (`tests/api/reprocessability/member-email-change.test.ts`) covers the change. This matters because Zoom, Slack and Stripe data often still carry the old address.

## 2026-06-30 · Engineering · Improved: Attendance rebuilt when member data or aliases change

Calendar prickles and attendance are reprocessed when aliases change, so historical attendance is matched to people added later.

Changing `member_name_aliases` now triggers calendar reprocessing so hosts re-match. Insights pages exclude future prickles and use a median, with a sparkline based on the chosen window. In early July, attendance matching started using `member_email_aliases` and processing every member regardless of status, and a member processing run schedules an attendance reprocess of the last 90 days in the background via `after()`. Integration tests cover that cascade.

## 2026-06-30 · Engineering · Fixed: Prickle ids stay the same when calendar and attendance are reprocessed

Reprocessing used to delete and recreate prickles with new ids, breaking links and attendance; prickles are now updated in place.

`reprocess_prickles_atomic` did DELETE then INSERT, so every run produced new uuids and broke /prickles URLs. Prickles now carry `calendar_event_id` (unique when set) and the function upserts on it, deleting only calendar prickles whose event is gone. Zoom-sourced pop-up prickles got the same treatment through `zoom_meeting_uuid`.

The first attempt made `zoom_meeting_uuid` alone unique, which was wrong: one Zoom meeting yields several segments. The final key is the composite (`zoom_meeting_uuid`, `start_time`, `end_time`), with the upsert repeating the partial-index predicate and duplicates merged by repointing attendance first. Reprocessability tests were updated, and an unrelated `::numeric` cast on the text `confidence_score` column was removed from the attendance function. This is the base of the rule that prickle ids are safe to link.

## 2026-06-14 · Engineering · New: Merging duplicate members, with detection and conflict warnings

Admins can merge two member records from a member page, in bulk, or from a Merge and Fix page that finds likely duplicates.

All three entry points call `POST /api/admin/members/merge`. It moves attendance, activities, hiatus and override rows, hosted prickles, ambiguous-name references, name aliases and email aliases to the kept member, copies `kajabi_id`, `stripe_customer_id` and `user_id` when the kept member lacks them, deletes derived metrics (recomputed later) and finally deletes the duplicate. Foreign keys are handled in a fixed order, documented in docs/MEMBER_MERGE.md. When both members have different external ids the primary's wins and the response lists the conflicts.

`lib/member-duplicates.ts` (`detectDuplicates`, unit tested) groups by identical normalised name or email. On 21 June, an external-conflicts hygiene page and pre-merge warnings check Kajabi, Stripe and Slack. Reprocessing was changed so a secondary Kajabi contact cannot overwrite the primary. Staff are always active regardless of Kajabi. Dismissed duplicate groups later moved into the database, shared by all admins.

## 2026-06-13 · Engineering · Improved: Historical Zoom import and pagination fixes for 1000-row truncation

A script loads past Zoom meetings in batches, and several admin pages and reports that silently stopped at 1000 rows now page through everything.

The Zoom import gained a `skipProcessing` flag and a historical batch script (limited to 2026 because of the Zoom records API). Hygiene pages, the orphaned-meetings step and the report routes that silently truncated at Supabase's default 1000 rows now paginate, with a pagination test for attendance.

Tiny pop-up prickles (under five minutes with one attendee) are skipped, and process handlers are called directly from import routes to avoid Vercel deployment protection.

## 2026-06-12 · Engineering · New: Feature previews: admins opt in to unfinished features

A per-user table and a settings modal let admins switch on features still being built, and navigation items and pages are hidden otherwise.

`user_feature_previews` stores each admin's choices, `lib/features.ts` and `lib/features.server.ts` define and read the features, and `/api/feature-previews` toggles them. Nav items and pages check the flag, so unfinished work can ship to production dark.

## 2026-05-19 · Engineering · New: Profile photo, bio and social links carried into members

Member processing now copies a profile photo, bio and social links from Kajabi onto the member record, and profile pages show them with an initials fallback.

A migration added the profile columns to `members` and the `reprocess_members_atomic` function fills them. When several Kajabi customers share an email, the most recently updated one wins. A `MemberAvatar` client component falls back to coloured initials, because a server component cannot attach an image error handler.

Social and photo URLs are sanitised to block javascript: links, the Kajabi avatar CDN base is resolved, and social handles are normalised. A Gravatar fallback was tried and reverted because the API never returns Gravatar URLs.

Prickle pages were consolidated into one shared `/prickles/[id]` with role-aware links that respect sudo and hide attendee emails from non-admins.

## 2026-05-16 · Engineering · New: Weekly streak computation and member profile pages

A tested streak utility counts consecutive weeks of attendance, and a member profile page shows attendance history and streaks.

`lib/streaks.ts` groups join times into weeks and returns the current and longest run. The current streak is zero once the last attended week is more than a week behind, with a grace-period boundary test. The `/members/[id]` page pages through all of a member's attendance (past the 1000-row limit) to compute it, and the sidebar gained My Profile.

Later, in June, `/streaks` added sister streaks and streaks scoped to a specific prickle day and time, using each member's own time zone.

## 2026-05-15 · Engineering · New: Sudo mode: admins browse as a member, via a signed cookie

An admin can view the app as a chosen member; the choice is carried in a tamper-proof cookie and a banner shows it.

`lib/sudo.ts` signs a cookie of admin id, member id and an HMAC (using `SUDO_SECRET`, compared with `timingSafeEqual`). `getEffectiveIdentity(user)` returns the sudo'd member only when the cookie's admin id matches the signed-in user and that user's `user_profiles.role` is admin; otherwise the user's own member record. It returns `memberId`, `memberName`, `memberEmail` and `isSudo`.

`startSudo` and `exitSudo` server actions, a banner and a Sudo As entry in the user menu complete it. Exit clears the cookies unconditionally and validates the return URL. Member pages are expected to use the effective identity and not the raw auth user.

## 2026-05-14 · Engineering · New: Admin and member route groups, with auth required by default

The app is split into an admin area and a member area, and everything except public routes now requires a signed-in user with the right role.

Admin pages moved into `app/(admin)/admin/` with their own layout and `AdminNavigation`; a `(member)` group got its own layout and `MemberNavigation`, a calendar of the member's own attendance, and profile pages. The root redirect sends admins to /admin and members to the calendar. Shared pieces (`UserMenu`, `SignOutButton`, `CalendarWeekView`) moved to `components/`.

`lib/supabase/middleware.ts` now redirects anonymous users on all non-public routes, but skips /api, which authenticates itself. A `requireAdmin()` helper in `lib/supabase/api-auth.ts` is applied to every non-webhook API handler. The default role in `user_profiles` changed from admin to member, and the middleware tolerates Supabase fetch failures.

A fix replaced `user_profiles` row-level security policies that recursed infinitely, and the profile trigger now schema-qualifies `public.user_profiles`.

## 2026-05-14 · Engineering · Improved: Project renamed to Hedgie Hub, Node pinned, Vercel Analytics added

The admin portal became Hedgie Hub (serving members and staff), Node 24 is pinned, and page views and web vitals are tracked in Vercel.

The package and docs moved from admin-portal to hub, with a new domain, because the app now serves members as well as staff. `.nvmrc` pins Node 24 LTS and the Vercel CLI was bumped to v54. The env sync script answers the git-branch prompt Vercel shows for preview environments.

Vercel Analytics and Speed Insights were added to the root layout.

## 2026-05-13 · Engineering · New: Branded sign-in emails built with React Email, with client-compatibility tests

The invite, confirmation, recovery, magic link and email-change emails are now React Email components with inline styles, and tests check how well they render across email clients.

Plain HTML templates lost their style blocks in Gmail, so the templates were moved to React Email, which renders inline styles. The rendered HTML stays committed in `supabase/templates/` so a fresh clone works without credentials, and `templates:render` regenerates it locally. A sync script pushes the templates to Supabase through the Management API so they stay in source control. Supabase's Go template variables are passed through as literal strings and substituted by its mailer.

Tests send each email to Mailpit over its HTTP API and read its HTML check report. One suite requires 80 percent support across all clients as a regression detector; a second covers the five biggest client families (Apple Mail, Gmail, Outlook, Samsung, Yahoo) and was raised to 95 percent. The tests skip if Mailpit is not running.

## 2026-05-12 · Engineering · New: Reconciliation dashboard comparing Kajabi and Stripe

An admin report finds members whose Kajabi status and Stripe subscription disagree, so staff know where to act.

`/api/analyze/subscription-reconciliation` and a reconciliation page compare the two sources, limited to membership offers (payment plans and retreats are ignored on both sides). A paused Stripe subscription with an inactive Kajabi record is correct and is not flagged; only real mismatches are.

Matching goes by email to `kajabi_customers` and then to purchases by customer id, because `members.kajabi_id` turned out to be stale. The analysis was written up in docs/STRIPE_KAJABI_COMPARISON.md and related files. Tests for the overrides and reconciliation routes were added in the same stretch, using the real database with the service-role helper.

## 2026-05-12 · Engineering · New: Local tables for status overrides and ambiguous Zoom names

Staff can record people who should count as active despite billing data (gifts, hiatus), and names that Zoom attendance cannot resolve to one member are tracked.

`member_status_overrides` is a Local-layer table, a source of truth like `member_name_aliases` and not derived from Bronze. It covers gifted or comped access (for example a program, hosting or compensation), hiatus, and other special cases. An admin page (`/dashboard/member-overrides` at the time) and `/api/member-overrides` manage it.

`ambiguous_zoom_names`, with an upsert function, records Zoom display names that match several members so they can be resolved by hand later.

`lib/supabase/api-auth.ts` gained a shared service-role bypass so integration tests can call protected routes without a browser session. A seed note: truncating `members` cascades into `prickle_types`, so the seed must re-create the Pop-Up Prickle type.

## 2026-05-12 · Engineering · Improved: Member processing rebuilt on the Kajabi Bronze tables

The members step now reads Kajabi contacts and purchases from Bronze, so it can be re-run from raw data at any time.

`app/api/process/members/route.ts` was rewritten to read `kajabi_contacts` and `kajabi_purchases` instead of the legacy CSV-import tables, which makes the Silver `members` table fully reprocessable from Bronze plus Local data.

In `lib/member-matching.ts`, a member alias now carries a `source` ('zoom' or 'slack'), and `matchAttendeeToMember` returns an explicit ambiguous result when more than one member fits, instead of null, so callers must handle that case.

## 2026-05-12 · Engineering · New: Stripe customers, products and subscriptions imported into Bronze

A Stripe client and import route copy customers, products and subscriptions into raw tables, so we can tell active from paused or cancelled members.

Kajabi's API does not expose a paused subscription, so Stripe is treated as the authority for active, paused and cancelled. `lib/stripe/client.ts`, `app/api/sync/stripe/route.ts` and an import form on the data import page do the fetch; migrations create the Bronze Stripe tables.

The data was kept Bronze-only at first, and not merged into Silver until the reconciliation rules were settled.

Writes go through the SQL functions `upsert_stripe_customers`, `upsert_stripe_products` and `upsert_stripe_subscriptions`, because the PostgREST schema cache did not see the newly migrated tables right away. The subscription period dates were not on the root object in the Stripe API version used, so they were read with a cast, pending typings.

## 2026-05-12 · Engineering · New: Kajabi data imported through its API into Bronze tables

Contacts, customers, purchases and offers from Kajabi now land in their own raw tables, fetched through Kajabi's API instead of CSV uploads.

Migrations added `kajabi_contacts`, `kajabi_customers`, `kajabi_purchases` and `kajabi_offers` in the Bronze schema, and the older `subscription_history` and `member_hiatus_history` tables were marked deprecated because purchases (and later Stripe subscriptions) replace them.

`lib/kajabi/client.ts` and `app/api/sync/kajabi/route.ts` talk to Kajabi with an OAuth 2.0 client-credentials token. Kajabi's responses are JSON:API with everything under `attributes`, every request needs a site filter or the API returns a 500, and the purchases endpoint gives no total page count, so paging stops when a page comes back short. A customer's email is not on the purchase, so the import fetches customers separately and joins on the customer id.

Subscriptions are purchases in Kajabi, not a separate resource, which is why the later membership logic reads purchases.

## 2026-04-28 · Engineering · New: Kajabi and Slack imported straight from their APIs

Production imports pull from the Kajabi and Slack APIs, and the CSV uploads moved to a separate testing page.

`lib/kajabi/client.ts` uses the OAuth client credentials flow, caching the access token until 90 percent of its life, with paginated JSON:API fetches and a required site filter. `POST /api/sync/kajabi` imports contacts and purchases. Kajabi has no subscriptions endpoint, so subscriptions are read from purchases (a null deactivation time means active, amounts converted from cents), and customers are fetched and joined by id because the purchase lacks the email that hiatus processing groups by; purchases with no customer are skipped with a warning. `POST /api/import/slack-api` imports messages and reactions for a 7, 30 or 90 day window, auto-joining public channels, with a five minute duration. Both write Bronze idempotently and trigger processing. `/data/import` now shows API imports, and `/data/import/testing` keeps the CSV forms for development. Several commits that day only added pagination logging while diagnosing a page of 100 records.

## 2026-04-27 · Engineering · New: Pre-commit hook that runs the production build

A git hook runs the production build before each commit so type errors that only appear in a strict build are caught locally.

`scripts/install-hooks.sh` installs a hook running `npm run build` and blocking the commit if it fails, with `--no-verify` as an escape hatch. It was added after several deployments failed on type errors that the dev server had accepted (missing interface properties, null safety, mismatches), including two fixes on April 26.

## 2026-04-23 · Engineering · Fixed: Members are upserted by email so ids and relationships survive reprocessing

Rebuilding members by delete and insert gave everyone a new id and orphaned aliases, hosts and attendance, so members now keep their ids.

The earlier delete-and-insert members processing was a mistake for an identity table. The atomic function now upserts by email: the same email keeps the same id, so aliases, prickle hosts and attendance foreign keys stay valid, and people who leave are kept as inactive rather than removed. The architecture spec was updated to separate two patterns: identity entities (members, products, channels) are upserted by a stable key over the full table, event entities (prickles, attendance) are deleted and inserted by scope so orphans disappear. Alias reprocessing also now triggers calendar processing, and attendance is reprocessed when calendar prickles change.

## 2026-04-23 · Engineering · Improved: Atomic reprocessing in SQL functions so readers never see half-rebuilt data

Prickles, attendance and members are replaced inside one database transaction instead of a delete followed by separate inserts.

Migrations add `reprocess_prickles_atomic` (date-scoped calendar prickles), `reprocess_prickle_attendance_atomic` (date-scoped attendance and pop-ups, using CTEs to insert PUPs, map client-side temporary ids to real ones and insert attendance referencing both) and `reprocess_members_atomic`. They are split one function per migration file because the local migration runner cannot send several CREATE FUNCTION statements in one prepared statement; batch sizes were also reduced to stay under URI length limits. The processing routes call them through RPC.

## 2026-04-23 · Engineering · New: Webhook receivers for Google Calendar, Zoom and Slack with signature checks and tests

Live updates arrive at webhook endpoints that verify who sent them, write to Bronze and start processing without making the sender wait.

`/api/webhooks/calendar`, `/zoom` and `/slack` upsert to Bronze, fire Silver processing and answer 200 quickly; the Slack route uses the service role client because no user session exists. The first version only marked verification as a TODO. Three days later it was implemented: Google channel token, Zoom HMAC-SHA256 signature, and Slack HMAC-SHA256 with a five minute timestamp window, each degrading gracefully when a secret is unset. Tests use Mock Service Worker with fixtures based on official payload documentation (27 tests, four skipped pending a test database), with `docs/WEBHOOK_TESTING.md` and setup docs.

## 2026-04-23 · Engineering · New: Nightly reconciliation of calendar, Zoom and members from Vercel Cron

Three scheduled jobs re-fetch the last 90 days from Google Calendar and Zoom and rebuild members, as a safety net for anything live updates miss.

`/api/reconcile/calendar`, `/api/reconcile/zoom` and `/api/reconcile/members` upsert into Bronze (calendar and Zoom from their APIs; members from the latest Kajabi snapshot, since Kajabi was imported by CSV then) and trigger Silver reprocessing. `vercel.json` schedules them at 2:00, 2:30 and 3:00, staggered so calendar data exists before attendance needs it. They authenticate with a `CRON_SECRET` bearer or a signed-in user. A README documents the jobs. This is the start of the rule that nothing may depend on webhooks alone.

## 2026-04-23 · Engineering · New: Prickle types can require a host and name a default one

Staff can say which prickle types need a host and who hosts by default, so the host health metric counts only real gaps.

Migrations add `requires_host` and `default_host_id` to `prickle_types` and two more seeded types, and fix RLS policies for `prickle_attendance`, `member_name_aliases` and the Bronze tables so upserts work for signed-in users. Calendar processing falls back to the default host when a title has no host in it. A missing hosts page with member autocomplete lets staff assign defaults. The host assignment card now shows a percentage over only prickles requiring a host (93 percent instead of 53 in the commit's example). Shared `formatters` and a `Modal` component were extracted in the same pass.

## 2026-04-22 · Engineering · New: Imports and local changes now trigger Silver reprocessing automatically

After an import, or after staff change an alias, an ignored name or a prickle type, the affected Silver data is rebuilt without a button press.

`lib/processing/trigger.ts` knows which Silver layers depend on which source and runs them in order. Bronze imports reprocess the date range they covered; changes to Local tables (name aliases, ignored Zoom names, prickle types, bulk alias application) reprocess the last 90 days by default. The dependency map is an ordering constraint only: a later fix noted that members changing should not force prickles and attendance to reprocess. Hiatus processing (from `subscription_history` into `member_hiatus_history`) was added after members, and Slack processing was added too. The manual process buttons on import cards were replaced by a Manual Reprocessing section for custom ranges, and import responses now wait for processing and show its results. The Zoom import fixed its conflict key to meeting, participant id and join time and began filling `zoom_meetings`.

## 2026-04-22 · Engineering · New: Email aliases so one person with several addresses is one member

A member who appears in Kajabi under more than one email is merged into one record, with external ids combined.

The Local table `member_email_aliases` maps alternative emails to a canonical one. Members processing resolves aliases first, deduplicates by the canonical email and merges Kajabi and Stripe ids across all of a person's addresses. It follows the member identity management spec in the docs.

## 2026-04-22 · Engineering · Improved: Bronze tables move into their own Postgres schema; attendance becomes prickle_attendance

Raw import tables now live in a bronze schema and each table is labelled Bronze, Local or Silver, so the layers are visible in the database.

Following the architecture-foundation spec, migrations create a `bronze` schema and move `kajabi_members`, `calendar_events`, the Zoom tables (adding a `zoom_meetings` table), `subscription_history` and the Slack tables into it, and `attendance` is renamed `prickle_attendance` (29 files of code updated in a separate commit). Table comments declare the layer: Bronze is raw data with idempotent imports, Local is operational data this app owns and never reprocesses, Silver is derived and reprocessable. PostgREST had to be told: the `bronze` schema was added to exposed schemas and the search path, queries use `.schema('bronze').from()`, and grants were added for the new tables.

## 2026-04-09 · Engineering · New: Slack processing into member activities, with matching and reprocessability tests

Slack messages and reactions become member activity rows, matched to members by a dedicated library, and shown on member pages.

`lib/slack-matching.ts` matches Slack users to members, and `POST /api/process/slack` follows the pipeline rules: paginated Bronze reads, in-memory matching, DELETE then INSERT into `member_activities` in chunks of 500, deleted messages and removed reactions skipped, an engagement value derived from message characteristics, and `maxDuration` of 300. Reprocessability, import idempotency and matching tests were added with it. On April 10 member pages gained a Slack Activity section (message and reaction counts, last 30 days, active channels, a recent feed with emoji rendering and links), and later filters by type and channel.

## 2026-04-09 · Engineering · New: Slack data lands in Bronze: tables, an export script and a CSV import

Slack messages, reactions, channels and users are stored raw, loaded first from an exported set of CSV files.

A migration adds `slack_messages` (unique on channel and message timestamp, with a `deleted_at` soft delete), `slack_reactions` (unique per message, reaction and user), `slack_channels` and `slack_users`, plus an `ignored_slack_users` hygiene table and a `source` column on `member_name_aliases` for Slack aliases and Slack activity types. `scripts/export-slack-data.ts` (built on `@slack/web-api`, run with tsx) exports users, channels, messages and reactions and auto-joins public channels (a `channels:join` scope in the checked-in app manifest, which holds placeholders only). `POST /api/import/slack` parses the CSVs, including fields with embedded newlines, accepts the service role key for scripts, and `SlackImportForm` uploads four files at once. The unmatched users report, manual alias creation and skip-a-non-member APIs support the next step.

## 2026-04-08 · Engineering · Improved: Kajabi and Stripe ids merged across imports; automation options researched

Member records pick up both a Kajabi contact id and a Stripe customer id even though they come from different CSV exports.

Contacts exports carry the Kajabi contact id and subscriptions exports carry the Stripe customer id (as the provider id when the provider is Stripe), so using only the latest snapshot lost one of them. Processing now groups snapshots by email, takes the core fields from the latest, and the first non-null external id from any snapshot, which feeds Kajabi and Stripe links on the member page header. `docs/KAJABI_API_SETUP.md` and an analysis document compare three ways to stop exporting by hand: the Kajabi API, bulk export, and Zapier or Make versus a browser scraper.

## 2026-04-07 · Engineering · New: Profile settings: theme in the browser, timezone in the database

Users can pick light, dark or system theme and a timezone, stored in different places on purpose.

Theme uses `next-themes` with class-based dark mode in Tailwind and is kept in localStorage because it is a device choice. The timezone preference is a `timezone_preference` column on `user_profiles` with an RLS policy so users can update their own row, set through a server action, with 40 or more zones grouped by region and defaulting to the browser's zone; calendars and timezone dropdowns use it as default. The reason for the split is documented in comments in the switcher components. The same day a bug where creating users in Studio failed was fixed: the profile-creating trigger runs as the auth admin role, which lacks the public schema in its search path, so the function now qualifies `public.user_profiles` and sets `search_path`.

## 2026-04-07 · Engineering · New: Member detail pages gain an attendance calendar and a network graph

A member page can show attendance as a month calendar, and a new page draws who attends prickles together as a graph.

`app/dashboard/members/[id]/AttendanceCalendar.tsx` adds a monthly grid with up to three prickles per day and a details panel for the chosen day, with list and calendar subtabs. `/dashboard/members/network` is a force-directed graph with its own physics simulation: node size from total attendance, edge thickness from co-attendance, the top 50 connections by default, search and click to focus one member, and pan and zoom controls. Fixes for hydration mismatches in the sidebar, a mobile navigation flicker and filtering of edges for calendar prickles accompanied it.

## 2026-04-07 · Engineering · Fixed: Reprocessing fixed for meetings that cross midnight and for deleted source data

Processing now deletes and selects everything that overlaps the date range, and always cleans up before checking whether there is new data.

Three reprocessability bugs, each with a regression test. First, the range queries used containment (start and end both inside), so a prickle from 11:30 PM to 12:30 AM was neither deleted nor selected and orphans accumulated; they became overlap queries (starts before the range ends, ends after it starts). Second, date-only inputs such as 2026-04-07 meant midnight, so the range end was normalised to the start of the next day. Third, attendance processing returned early when no attendees were found, before its DELETE statements ran, so removing Bronze data never removed the Silver pop-ups; the deletes now run first. A `test seed` fix for prickle types was needed for those tests.

## 2026-04-07 · Engineering · New: Data hygiene dashboard: orphaned events and meetings, ignored Zoom names, host coverage

Staff get a health page that finds source data that never made it into prickles, with buttons that reprocess exactly the affected range.

Under `/hygiene` the dashboard counts calendar events that are in neither prickles nor the unmatched queue (found to come from events imported just outside the processed date range) and Zoom meetings with no prickle, each with a button that calls the matching `/api/process/*` route over the exact range instead of a guess; a fixed six-month fallback was removed in favour of a clear error. A bug was fixed where the orphaned-meetings count used every attendee's window while processing used only matched attendees, so the number never fell to zero after processing; a regression test was added. An `ignored_zoom_names` table with `/api/zoom/ignore` lets staff mark bots and test accounts so they leave the unmatched list, the unmatched page can show the prickles a name appeared in, and a host assignment percentage was added so missing hosts become visible. The URL structure was flattened into `/calendar`, `/data/*` and `/hygiene/*`.

## 2026-04-06 · Engineering · Improved: Staff decisions on unmatched calendar events survive reprocessing

Events staff resolve or ignore stay that way after the calendar is reprocessed, and prickles can have a fun title separate from their type.

Because processing now deletes and rebuilds prickles, the review queue would have asked the same questions after every run. Processing loads previous resolved and ignored decisions first: resolved events use the stored type, ignored events are skipped, and the UI reports auto-resolved and ignored counts. Related changes the same day: a partial-match fallback for type names, a `title` column for named prickles that is stored only when it differs from the type, fixing a type whose normalised name in seed data did not match what the normaliser produces, and unmatched event cleanup in batches. Orphaned aliases are removed when members are processed, since member ids changed on each run at the time.

## 2026-04-06 · Engineering · New: Staff table so team members who are not in Kajabi still become members

Owners, staff and contractors are kept in their own table and combined with Kajabi contacts when members are processed.

The `staff` table is an internal source of truth for people who do not pay through Kajabi. Members processing reads two Bronze sources, `kajabi_members` and `staff`, into `members`, which gained a `source` column, a `staff_role` and a `user_id` that links to the auth user for admin access. Without it, staff who host or attend prickles showed up as unmatched Zoom names. The processing UI shows the breakdown by source, and a duplicate-by-email problem when combining the sources was fixed on April 10.

## 2026-04-06 · Engineering · New: Idempotency tests for every Bronze import, and a calendar sync race fixed

Each import (calendar, Zoom, members) is tested to be safe to run repeatedly, after a concurrent sync caused duplicate key errors in production.

Suites in `tests/api/idempotency/` check that a first import creates rows, a second with the same data creates none, changed data updates (upsert) or adds a new snapshot (append), and several cycles are stable. They cover three patterns: upsert on a natural key, upsert that ignores duplicates, and append-only snapshots. The race fix: the calendar sync checked for existing events first and then inserted, so two overlapping requests collided on `google_event_id`; the insert became an upsert on that key as the final guard. A test helper seeds reference tables, and `docs/TEST_INFRASTRUCTURE_PLAN.md` set out a phased plan (fixtures, mocked external APIs, per-suite databases) for the shared-database interference the tests suffered from.

## 2026-04-06 · Engineering · New: Reprocessability: Silver is rebuilt from Bronze with delete and insert, with tests

Silver processing was changed to delete the affected rows and insert fresh ones, so a deleted source event disappears, and regression tests were added for it.

Selective inserts and updates had left orphans: an event deleted in Google Calendar stayed in prickles. A later change switched calendar and members processing (attendance already did) to DELETE then INSERT within the scope, and the principle was documented in `CLAUDE.md` with correct and incorrect examples and a status table. Tests under `tests/api/reprocessability` verify four things: first run creates rows, reprocessing after source deletion removes them, changed source updates them, and orphans are detected. To let those integration tests call the routes, the three `/api/process/*` routes accept the service role key in the Authorization header as well as cookies, with a helper in the tests. The members route later stopped deleting all members (see the April 23 entries), because it regenerated member ids.

## 2026-04-06 · Engineering · Improved: One TypeScript library for matching names to members

The routes that matched Zoom names to members each did it their own way; a shared library with one priority order replaced them.

`lib/member-matching.ts` matches by email, then alias, then normalized name, in one place, with 18 tests and `docs/MEMBER_MATCHING.md`. It was introduced because a quarter of active members showed zero attendance purely from name mismatches. Seed aliases were added in a CSV for the common cases. On April 7 the SQL stored procedures were deleted in favour of this code, matching became case-insensitive, and a smart-matching step handled variants without needing an alias. The processing routes and the hygiene dashboard were moved to call the same function so the counts agree. A later fix trimmed trailing whitespace from Zoom names before the alias lookup, and calculated a meeting window from matched attendees only, which removed pop-ups with zero attendees.

## 2026-04-06 · Engineering · Improved: Attendance keeps one row per stay: multiple records per member and prickle

The unique constraint on member and prickle was dropped so someone who leaves and rejoins a prickle has both stays recorded.

Deduplicating attendance on (member_id, prickle_id) first fixed an upsert failure (every row was rejected with Postgres error 21000 because two rows conflicted in one statement), but merging a stay from 9:00 to 9:30 with another at 11:00 to 11:30 would have reported a span of 150 minutes instead of 60. A migration drops the `attendance_member_id_prickle_id_key` constraint, processing uses plain inserts, and tests assert that counting uses `COUNT(DISTINCT prickle_id)` while time is the sum of the segments. The design rule is recorded in `CLAUDE.md` as a standing instruction not to reintroduce the constraint.

## 2026-04-06 · Engineering · New: Pagination regression tests and the first CLAUDE.md architecture rules

After calendar processing silently dropped events past the first 1000, tests and project instructions were added so it could not happen again.

`tests/api/process-calendar-pagination.test.ts` checks behaviour (1500 events all processed) and the code shape (range-based pagination present, a single unpaginated query absent). `CLAUDE.md` was created with the database query limit rule, the API route performance rules and a code review checklist, so that agents working in the repo load them every session. A bug found later the same day was an unmatched-events query that loaded only events matching a list of ids; it was changed to page everything by date range, and batch deletes were chunked to stay under the limit of `.in()` filters.

## 2026-04-06 · Engineering · Improved: Processing routes load reference data once and write in batches

Calendar and attendance processing dropped from thousands of sequential queries to a few dozen, which got them under the serverless time limit.

Production processing timed out because routes ran a query per event or attendee (about 6500 for 1337 calendar events, about 1200 for attendance, including one name-matching RPC per attendee). Both routes now load prickles, members, aliases and types up front with `Promise.all()`, match in memory with Map lookups, and write in chunks of 100 to 500 with parallel execution. Process and sync routes also declare `maxDuration = 60` (the default was 10 seconds). These became the written API performance rules in `CLAUDE.md`.

## 2026-04-05 · Engineering · New: Deployment to Vercel and a hosted Supabase project documented

A step-by-step guide covers creating the Supabase project, pushing migrations, configuring Vercel and a security checklist before going live.

`docs/DEPLOYMENT.md` and `.env.example` describe the project setup, which environment variables are needed and where to turn off public signups, plus troubleshooting. Fixes the same evening were for TypeScript errors in chart formatters and the host relationship that only the production build caught, which led later to a pre-commit build check.

## 2026-04-05 · Engineering · New: Row Level Security on every table, invite-only sign-in and a navigation shell

All tables got RLS and a user profile with a role, public sign-up was turned off, and the admin area got a collapsible navigation.

A migration creates `user_profiles` (role admin, assistant or member), enables RLS on all Bronze, Silver and Gold tables, adds an `is_admin()` helper and a trigger that creates a profile on sign-up. At this stage every authenticated user was an admin with full access, with the policies written so they can be refined per role later; `docs/RLS_SECURITY.md` records the migration path. `enable_signup = false` in `supabase/config.toml` means accounts are created only by invitation (`docs/INVITING_USERS.md`). The navigation was reorganised into Data Hygiene and Data Management sections.

## 2026-04-05 · Engineering · New: Dashboard charts and a short list of engagement KPIs

The dashboard gained attendance charts and was then trimmed to five key metrics.

Added a stacked weekly attendance bar chart with unique attendees and tooltips, a weekly engagement rate (measured over the last seven days rather than a calendar week) and median hours, and a blue and green palette for contrast. After trying several KPIs the dashboard was cut down to five. The data is still computed in the page queries rather than stored.

## 2026-04-05 · Engineering · New: Weekly calendar view, prickle detail page and host warnings

Staff can browse a seven-day calendar of prickles with attendance, open a prickle, and see warnings where a host is missing or late.

`app/dashboard/calendar` renders a week grid from prickles and attendance (Sunday-first), with a timezone selector, tooltips, an option to show or hide pop-ups, and detail pages at `/dashboard/prickles/[id]`. Host warnings flag prickles with no host or one who arrived late. Several fixes in the day dealt with Next.js 15 async `searchParams` and with week parameters parsed in the wrong timezone, a class of bug that recurs in later weeks.

## 2026-04-05 · Engineering · Improved: Attendance processing rewritten to split Zoom meetings into prickle segments

A long Zoom meeting is now cut into scheduled prickles and pop-ups by documented time rules, and each attendee is assigned by when they were actually present.

The first matcher treated each attendee alone and produced overlapping or very long PUPs. The rewrite in `app/api/process/attendance/route.ts` follows the analytics logic of the earlier Python tool: it handles a whole meeting as a unit and splits it into segments. Early and late arrivals of up to 20 minutes are absorbed by the first and last scheduled prickle, longer ones form separate PUPs, and gaps between scheduled prickles become PUPs. A three-pass algorithm (match calendar prickles, create PUPs only from attendees who matched no calendar prickle, then write attendance) fixed PUP windows that stretched across a day. Attendance in a PUP counts only above 15 minutes, using each attendee's own join and leave times, so showing up early for the next prickle is not credited as a PUP. `docs/ATTENDANCE_RULES.md` lists every threshold (20, 15 and 5 minutes for host-late warnings) with rationale.

## 2026-04-05 · Engineering · New: Prickle types table, host parsing and Pop-Up Prickles

Prickles now have a type from a lookup table, a host linked to a member, and unscheduled Zoom meetings become Pop-Up Prickles.

A migration removes the free-text title from prickles in favour of `type_id` pointing at a seeded `prickle_types` table (13 types, such as Progress, Pop-Up and Heads Down), with admin screens at `/dashboard/prickle-types`. `lib/prickle-types.ts` normalises variants of a type name and parses the type and host from calendar titles; events it cannot place go into an unmatched calendar events queue for staff to review. A Zoom meeting that overlaps a calendar prickle by at least 15 minutes is matched to it; one that does not becomes a Pop-Up Prickle (PUP). Later the same day `prickles.host` changed from text to a foreign key to members, which also enabled member detail pages with attendance history and a marker on prickles they hosted.

## 2026-04-05 · Engineering · Fixed: PostgREST row limit hit: raise-the-limit abandoned for real pagination

Calendar processing silently saw only 1000 events; the fix was to page through results in batches rather than keep raising the server limit.

Supabase's API returns at most `max_rows` rows no matter what `.limit()` asks for. The first fix raised `max_rows` in `supabase/config.toml` to 10000, then settled at 5000, but the real change was `/api/process/calendar` reading events in 1000-row batches with `.range()`. The reasoning recorded in the commit: a hardcoded ceiling is only a delay, while paging works for any volume. This became the project's standing rule (paginate anything that can exceed 1000 rows), and the next day regression tests were added for it.

## 2026-04-05 · Engineering · New: Google Calendar sync into a Bronze events table, processed into prickles

The community calendar is read with a service account into raw calendar events, and a separate step turns those into prickles, so the schedule is rebuilt from source.

The first version used OAuth with a stored refresh token and upserted straight into prickles; it was replaced the same day by a Google service account (the calendar is shared with it, no token expiry or user interaction). The next refactor applied the medallion rule: `POST /api/sync/calendar` writes unmodified events (full event JSON, creator and organizer) to the Bronze `calendar_events` table, idempotently by upsert, defaulting to 30 days back and 90 forward, and `POST /api/process/calendar` transforms them to prickles. Processing extracts the prickle type and host from titles shaped like a type, then w/, then a host, and normalises type spellings. `docs/CALENDAR_SETUP.md` and `CALENDAR_SYNC.md` describe the setup and automation options.

## 2026-04-05 · Engineering · New: Name matching tools: unmatched report, drag-and-drop game and alias search

Staff get pages that show which Zoom names did not match anyone and a quick way to link them to members as aliases.

`/dashboard/name-matching` started as a report (active members with zero attendance, Zoom names seen three or more times without a match, and possible matches by email) backed by `app/api/reports/name-matching/route.ts`, written to push the match rate beyond the roughly 92 percent the automatic rules achieved. It became an interactive drag-and-drop pairing page (`MatchingGame.tsx`) saving through `app/api/aliases/route.ts`, then gained `/dashboard/aliases`, a search-and-autocomplete form that can attach a name to any member, since writers can have several identities, pen names and emails. The unmatched list was changed to use the real match function instead of a lookalike query, so it cannot disagree with processing.

## 2026-04-04 · Engineering · New: First engagement dashboard with at-risk members

The admin dashboard shows member counts, recent prickles, top attendees and a list of active members who have not attended lately.

`app/dashboard/page.tsx` queries member stats (total, active, on hiatus), prickles in the last 30 days, attendance totals and the top ten attendees, plus an at-risk list: active members with no recent attendance, fixed to include those with zero attendance ever. A dedicated at-risk page lists them all. These were computed live in the page, which is what the Gold layer meant at the time.

## 2026-04-04 · Engineering · Improved: Medallion split: imports write Bronze only, processing routes build Silver

Imports store raw data untouched and separate processing routes compute members and attendance, after matching logic was pulled back out of the raw Zoom table.

The rule written down in `supabase/ARCHITECTURE.md`: Bronze tables hold only what the source said, Silver is inferred. Matching columns added to `zoom_attendees` were reverted for that reason. `POST /api/process/members` now builds `members` from the latest `kajabi_members` snapshot per email; `POST /api/process/attendance` reads `zoom_attendees` in a date range, matches each to a member (email, alias, normalized, fuzzy), creates prickles from Zoom meetings (with a `zoom_meeting_uuid` and a `zoom` source) and writes `attendance` rows with a confidence score, skipping unmatched people and reporting match rates. The follow-up doc commit also records data-flow dependencies between routes and the idea of moving to streaming later. This split is the basis of everything that followed.

## 2026-04-04 · Engineering · New: Name matching in SQL: email, alias, normalized and fuzzy

Zoom display names can be matched to members in four steps of decreasing confidence, using a manual alias table and trigram similarity.

A migration adds the `member_name_aliases` table, a `normalize_name()` function (case, whitespace, punctuation), `match_member_by_name()` and the `pg_trgm` extension. Priority is exact email, then manual alias, then normalized name (all high confidence), then trigram similarity of at least 0.4 (medium or low). Because Zoom attendees often join under a nickname, this ordering returns the most trustworthy match first and carries a confidence score forward. Tests covered each tier. Matching was briefly written into `zoom_attendees` and reverted the same day (see the medallion entry); the logic moved to TypeScript three days later.

## 2026-04-04 · Engineering · Fixed: Member status derived from Kajabi products and tags, with Offboarding first

Active, on hiatus and inactive are worked out from what a Kajabi contact has, and the Offboarding tag now wins over a lingering membership product.

The first rules in `app/api/process/members/route.ts`: a membership product means active; the member tag without the product means the member paused (hiatus); neither, or an Offboarding tag, means inactive. Two fixes came from real data. Hiatus members lose the product but keep the tag, so checking tags alone missed them. Cancelled members could keep the product, so the Offboarding tag is now checked before products. The dashboard's total members count stopped including inactive people. The same commit added the Supabase style rules under `.claude/rules` that later agents followed.

## 2026-04-04 · Engineering · New: Kajabi CSV imports stored as temporal snapshots

Member data comes in from Kajabi CSV exports that are auto-detected, and every import is kept as a dated snapshot so changes over time can be seen.

`POST /api/import/members` detects a Kajabi contacts export by its columns, and later a subscriptions export (customer email, status, subscription id; when one email has several subscriptions it picks Active over Paused over Canceled, and accepts two date formats). The raw rows go to `kajabi_members`, first as one row per email, then refactored the same evening to a history table: uuid primary key, `email`, `imported_at`, and the whole CSV row as JSONB, unique on email plus import time, and inserted rather than upserted. That keeps an audit trail and makes it possible to detect when tags or products changed, which is the basis for deriving hiatus periods. The subscriptions export was added because the contacts export left stale products on cancelled members.

## 2026-04-04 · Engineering · New: Zoom import: API client with retry and an immutable attendee table

Zoom meetings and participants can be imported by date range into a raw attendees table, with backoff on rate limits and no duplicates when ranges overlap.

`lib/zoom/client.ts` does the OAuth flow and fetches meetings and participants; `POST /api/import/zoom` stores them in `zoom_attendees`, driven from an import page in the dashboard. Two hardening steps followed. The client retries 429 responses with exponential backoff (1s doubling up to 16s, five tries) and shorter backoff on transient network errors. The attendee table became effectively immutable: a unique constraint on meeting UUID, name and join time plus an upsert that ignores duplicates, so re-importing an overlapping range never doubles anyone. This is the opposite choice from the Kajabi snapshots, deliberately: a Zoom participant row is a fact, a Kajabi contact is a state.

## 2026-04-04 · Engineering · New: Declarative database schema in Bronze, Silver and Gold layers; sessions become prickles

The data model is written as a declarative schema file organised as a medallion architecture, and the community's own word, prickle, replaces session in the schema and code.

`supabase/schemas/schema.sql` declares members, `zoom_attendees` (shaped like the Zoom API's participant report, with the full raw payload), prickles, attendance, member metrics and a CRM-style `member_activities` log with a flexible JSONB metadata column and a weighted engagement value. Hiatus periods live in `member_hiatus_history` as the single source of truth, with an `on_hiatus` status on members. Layers are Bronze (raw), Silver (transformed) and Gold (analytics views such as prickle popularity). A same-day migration then renamed `sessions` to `prickles`, including `session_id` to `prickle_id` and the popularity view, and the dashboard gained its first hedgehog mascot welcome. Migrations sit in `supabase/migrations`, generated from the schema file.

## 2026-04-04 · Engineering · New: Passwordless sign-in with Supabase magic links and a local Supabase stack

Sign-in is by emailed magic link only, with Next.js middleware protecting the dashboard and a Docker-based local Supabase with Mailpit for catching emails.

`/login` asks for an email and Supabase Auth sends a magic link; `app/auth/callback/route.ts` exchanges it for a session and redirects to `/dashboard`. Client and server Supabase helpers use `@supabase/ssr`, and middleware redirects anonymous visitors away from protected routes. Local development runs Supabase in Docker and reads the emails in Mailpit instead of sending real ones. `SETUP.md` documents the flow. No passwords exist anywhere, which kept the later invite-only decision simple.

## 2026-04-04 · Engineering · New: First app skeleton: Next.js, Tailwind and the product requirements doc

The repository starts as a Next.js App Router project with Tailwind, an internal landing page for stakeholders and a product requirements document rendered in the app.

The first working commit adds `app/page.tsx` (a roadmap, feature preview and tech stack page for stakeholders) and `docs/PRD.md`, which `app/prd/page.tsx` renders as formatted markdown with the Tailwind typography plugin. Tailwind, PostCSS and TypeScript are configured here. At this point it is an internal admin portal for staff, not a member-facing app, which shaped the early decisions: dashboards and data hygiene came before anything members would touch.
