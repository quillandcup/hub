# Changelog

<!-- Generated from lib/changelog/entries.ts by `pnpm changelog:generate`. Edit the entries, not this file. -->

What's new and fixed in the Hedgie Hub, newest first.

## 2026-11-04 · New: A changelog for the Hedgie Hub

See what's new and fixed in the Hub, right here in the Hub. Choose how you hear about updates in Settings → Notifications.

## 2026-11-03 · Engineering · New: Member data removal routine and a Community Manager role

A routine removes a member's data on request, and a read-only Community Manager role opens a fixed set of admin pages.

The removal routine has a staff entry point and a decision for every table that holds member data. Admins can preview the admin area as a Community Manager, and new admin pages stay closed to that role until they are added on purpose.

## 2026-11-03 · Engineering · New: Slack DM bridge, switched off

One-on-one Slack DMs can be pulled into chat for the members a feature flag covers, read with each member's own Slack token.

It has live delivery of new messages, a nightly pull, and a way to start a Slack DM from a profile's Message button. The feature is off for everyone as of this entry. /privacy describes what is read and kept, and the choice is to disconnect Slack. It becomes a product entry when it is on for everyone.

## 2026-11-03 · Fixed: Small fixes and polish

Fixes to chat, course videos, Slack check-in messages and the sign-in page.

## 2026-11-03 · Improved: One book, print and ebook

A book on your shelf can have a print edition and an ebook edition, each with its own link and price, on one card.

## 2026-11-02 · Engineering · New: Launch tooling

Sign-in accounts were created in advance for members, then released and emailed in batches, each with its own sign-in code.

pnpm auth:precreate and pnpm launch:email did the rollout. Both default to a dry run and take --limit and --only to trial it first, and the email can be re-run safely because each sent member is marked.

## 2026-11-02 · Engineering · New: Direct messages between members, behind a feature flag

Members can start a Hub-only direct message from a profile's Message button, switched off for everyone until it is rolled out.

These conversations stay in the Hub and nothing goes to Slack. They are private and restricted, so staff can see that one exists but not its text. The chat_dms feature decides who can start one. It becomes a product entry when it is on for everyone.

## 2026-11-02 · Fixed: Your calendar feed shows events at their time

One-day events you added to your subscribed calendar now appear at their start and end time instead of as all-day entries.

## 2026-11-02 · Improved: Course links preview, and course pages fit phones

A course link shared with someone who is signed out shows a preview, and the lesson and module pages show one back link on narrow screens.

## 2026-11-02 · Improved: Check-in and check-out are easier to reach

You can check in at any point while a prickle is running, and a running prickle on your upcoming list offers Check out beside Check in.

## 2026-11-02 · New: An Allow animations setting

Choose System, Allow or Reduce for animations in Settings. With animations reduced, moving images and emoji show a still.

## 2026-11-02 · Improved: Your conversations come first in the chat sidebar

The chat sidebar lists the conversations you are in, with a Browse channels button for the public channels you could join.

## 2026-11-02 · Improved: The chat box writes like Slack

The chat box shows your formatting as you write it, with bold, italic, underline, strikethrough, code, quotes, links and nested or numbered lists.

## 2026-11-02 · New: The Hedgie Hub is open to all members

Members can now sign in to the Hub, and the sign-in email carries a one-time code that works from any device.

## 2026-11-01 · Engineering · Improved: Faster CI and repository-based tests

Lint and type checks overlap with tests, and many tests use the in-memory repositories instead of faked database calls.

The notifier, channels, reminders and check-in messages now take repositories instead of database clients, and 176 PostgREST casts were removed by typing the boundary once. pnpm seed:local loads a typed seed profile into the local database.

## 2026-10-31 · Engineering · Improved: More tables behind repositories, and migration safety

Courses, billing, events, books, Zoom, Slack and the people and profile tables moved behind repositories, and a check now fails migrations that drop or rename what live code still uses.

The guard test parses the source and fails on a new direct query. Squawk runs in the Check migrations job, so removals ship in two pull requests: stop using it, then drop it.

## 2026-10-31 · Engineering · New: Course editor for Hub-owned courses, first parts

Staff can create and edit a course in the Hub, add, rename, duplicate, delete and reorder modules and lessons, and play a lesson's video in the builder.

This is staff-only and not visible to members yet. Reorders write a single audit entry with the order before and after. Courses are read and written through CourseRepository and CourseProgressRepository.

## 2026-10-31 · Fixed: Small fixes and polish

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

The privacy page opens with a short summary, answers questions in groups, and can be read without signing in. A switch lets you stop sharing usage statistics.

## 2026-10-30 · Fixed: Prickle and event descriptions keep their formatting

Descriptions imported from the calendar now keep bold, italic, links, bullet lists, paragraph breaks and dividing lines instead of running together.

## 2026-10-30 · New: Choose how the sidebar behaves

A button in the header cycles the sidebar between pinned open, auto-hide as an icon rail, and closed, and remembers your choice.

## 2026-10-30 · Improved: Shared lesson links show a preview

A course lesson link shared with someone who is signed out shows its title, a short teaser and a thumbnail, with a way to sign in.

## 2026-10-29 · New: Book covers at any size, from your own images

Upload a book cover at any size, pick it again from your own images and adjust its crop. We make the Amazon-size version for you.

## 2026-10-28 · Engineering · Improved: Google Calendar syncs from push notifications

The calendar sync opens and renews its push channel on its own and syncs only what changed.

Deletions outside the watched window are caught, and the admin calendar refreshes itself when the sync changes prickles. See CalendarSyncStateRepository in lib/data/calendar-sync-state.ts.

## 2026-10-28 · New: A better Events page

Events leads with what is coming up, with a picture on each card and a month-at-a-glance list that shows the time of day.

## 2026-10-27 · New: Continue watching on your dashboard

If you are partway through a course lesson, your dashboard shows a card that takes you straight back to it.

## 2026-10-27 · Improved: A help menu in the top bar

The help icon is now a menu with Hedgie Help and Send feedback.

## 2026-10-27 · Improved: Search finds nicknames and guest speakers

Member search now matches the other names a member goes by, prickle search matches guest speakers, and hosts and attendees show the name people go by.

## 2026-10-25 · Improved: Chat posts as you, not as a bot

Messages and files you post in chat now go out under your own connected Slack account.

## 2026-10-25 · Improved: Clearer navigation and a footer

The sidebar now separates Community, where you take part, from Explore, where you browse, and the My prefix is gone from your own pages.

## 2026-10-24 · Engineering · Improved: Typed Supabase clients and stale-type check

Every Supabase client is typed with the generated Database, and CI fails when the generated types are stale.

pnpm types:gen regenerates lib/data/database.types.ts and pnpm types:check runs in CI.

## 2026-10-24 · Fixed: Week calendars scroll on phones

On a phone you can now scroll sideways to Thursday through Saturday on week calendars instead of having them cut off.

## 2026-10-24 · Improved: Chat: mention people and channels, edit Slack-written messages

Type the at sign or the hash sign in chat to pick people and channels, and edit or delete messages you wrote in Slack once you have connected Slack.

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

## 2026-10-22 · Improved: Chat: day markers, Slack notices and adding people

Chat marks each day, shows times in your time zone, shows notices like channel renames, and lets you add people to a conversation.

## 2026-10-22 · Improved: Chat: files, images and a full emoji picker

Chat now shows images and files under messages, lets you send files to Slack, and has a full emoji picker with skin tones.

## 2026-10-21 · Engineering · Improved: pnpm, auto-merge, docs-only skips and container queries

The repo moved to pnpm, new PRs auto-merge on green, docs-only changes skip tests and deploy, and layouts use named container queries.

Named container sizes live in tailwind.config.ts. A production tag marks what is deployed. Migration order is checked in pre-commit and CI.

## 2026-10-21 · New: Edit and delete your chat messages

You can edit or delete a message you wrote in Hub chat, and the change reaches Slack too.

## 2026-10-20 · Engineering · New: Usage analytics with a tracking plan

Only declared events are stored, with funnels and a usage explorer for admins.

Events are declared in lib/analytics/events.ts and funnels in lib/analytics/funnels.ts. Members can leave usage statistics from /privacy. See docs/ANALYTICS.md.

## 2026-10-20 · Improved: Course cards, module pages and a clearer today

Courses show as cards with cover images, each module has its own page, and today stands out more on calendars in light mode.

## 2026-10-20 · Fixed: Cleaner previews for Hub links

A Hub link shared in Slack and elsewhere now shows a single centered picture instead of an empty or cropped image.

## 2026-10-20 · Improved: Connect Slack in Getting started

Getting started has a Connect Slack step, and connecting also keeps what you have read in sync between the Hub and Slack.

## 2026-10-20 · New: Choose your display name

Settings now says which name the community sees, and you can pick one of your pen names or write your own as your display name.

## 2026-10-19 · New: On air light

A light in the header shows when the prickle room has people in it and how to join.

## 2026-10-19 · New: Courses in the Hub

Watch the lessons of courses you have access to right in the Hub, mark them complete and pick up where you left off.

## 2026-10-18 · Improved: Join details for the prickle room

The check-in window, the Slack check-in message and your calendar feed now carry the prickle room's Zoom link, meeting ID and passcode.

## 2026-10-18 · Improved: Clearer time zone settings

The auto-detect option is gone, your current location is always one click away, and the time zone prompt no longer pops up after you pick a zone yourself.

## 2026-10-15 · Engineering · New: Big Sisters program, behind a preview flag

Matching, volunteers, introductions and a Big Sisters page were built behind a preview flag that is not on for everyone.

New members would get a big sister for their first 30 days, with staff choosing the match and arrival dates and trial outcomes derived from membership data. Not yet a general product update; add a product entry when the flag goes on. See docs/BIG_SISTERS.md.

## 2026-10-15 · Improved: A kinder nudge when a streak lapses

The sad broken-heart badge on upcoming prickles is now a seedling that invites you to start a new streak.

## 2026-10-15 · New: Gentle reminders to say hello and to plan a prickle

Newcomers get a nudge to say hello in the intro channel, and members with nothing planned can get a reminder to put a prickle on their calendar.

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

## 2026-10-12 · Improved: Chat feels faster and stays current

A message you send shows up the moment you press Send, and open conversations and threads update without reloading.

## 2026-10-11 · New: Hub chat can send as you

Connect your Slack account in Settings and the messages and reactions you send from Hub chat show up in Slack as you.

## 2026-10-10 · New: Hub chat, a first look

Read our Slack channels in the Hub, post and react from there, and optionally connect your Slack account so your messages go out as you.

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

## 2026-10-05 · Fixed: Small fixes and polish

Fractional amounts, check-out links and a lighter set of check-in options.

## 2026-10-04 · Improved: Check in and out from your attendance history

Attendance History now has check-in and check-out buttons for each prickle, and Find a Prickle always gives you something to consider.

## 2026-10-03 · Engineering · New: Notification framework with per-kind channels

Automatic messages go through one framework with per-kind, per-channel settings for each member.

Each kind of message is registered in lib/notifications/registry.ts and sent through createNotifier in lib/notifications/notify.ts, which honors member opt-outs. Delivery adapters live in lib/channels/ (Slack, then in-app and email). A message can be marked time sensitive until a given time, and each channel decides what that means. Admin Test Notifications sends every kind on every channel. Related product entries: check-in and check-out messages, notifications inside the Hub, and email notifications.

## 2026-10-03 · Fixed: Small fixes and polish

A handful of fixes to sign-in, notification settings and the dashboard.

## 2026-10-03 · New: Notifications inside the Hub

A bell in the header and a notifications inbox keep your check-ins and other messages in the Hub, with a banner for anything time sensitive.

## 2026-10-03 · New: A Getting started tour for new members

A checklist walks new members through setting up their details, introducing themselves, setting a writing goal and finding a prickle.

## 2026-10-03 · New: Check-in and check-out reminders from Billie Bot

Billie Bot now asks how you are feeling shortly before a prickle and how it went afterwards, and you choose where those messages arrive.

## 2026-10-02 · Engineering · Improved: Slack app manifest pushed from CI

The Slack app configuration is now code, pushed after each production deploy when it changes.

slack-app-manifest.yml is the source of truth and scripts/slack-manifest.ts pushes it after the production deploy, and only when it has changed.

## 2026-10-02 · Engineering · Improved: Config split between app.config.ts and layered env files

Shared deployment config moved into a committed app config, and secrets are layered across shared, preview and production env files.

Values that are the same everywhere live in app.config.ts and are read through lib/config.ts. Secrets use .env.shared with .env.preview and .env.prod overrides, synced by the env:sync scripts. Analytics tracking is production only, and Sentry events are tagged by environment.

## 2026-10-02 · Improved: Link your writing progress to the prickle you wrote in

When you log progress you can say which prickle it was during, and your dashboard reminds you about writing prickles you have not logged.

## 2026-10-02 · New: Prickle check-ins and a Prickle Picker that learns from them

Say how you feel and what you need before a prickle and how it went afterwards. The Prickle Picker uses your answers to suggest prickles that suit you.

## 2026-10-02 · New: Pitch prickle demo

We showed the Hedgie Hub in the Pitch prickle.

## 2026-09-29 · New: Sign in to the Hub from Slack

Open the Hedgie Hub straight from Slack, without waiting for an email link.

## 2026-09-28 · Improved: Writing goals: titles, profile visibility and clearer status

Goals can have a title and description, and you choose whether each shows on your profile. Finished goals now say Achieved or Ended instead of Behind pace.

## 2026-09-28 · New: Member directory, Ask me about topics and private notes

Search the Hedgies in the new Members page, share what you love to talk about on your profile, and jot private notes about people you meet.

## 2026-09-28 · New: Founding Hedgies demo

We demoed the Hedgie Hub to our founding Hedgies.

## 2026-09-27 · New: Your prickles in your own calendar, and commitments across several slots

Subscribe to a private calendar feed of the prickles you host, commit to or add by hand, and make a commitment that covers more than one weekly slot.
