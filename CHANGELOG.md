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
