# TODO / Future Enhancements

Reviewed 2026-10-21: completed items removed, duplicates merged. Sections below are grouped by area; entries within a section are roughly in priority order. The sales and marketing roadmap (CRM Features and the roadmap under UI Enhancements) is a separate product line from operations.

## Top Picks

**Member-facing**
1. Roll browser notifications out past their flag (`browser_notifications`); in-app is already on for everyone.
2. Chat drafts, synced with the Slack bridge (see Messaging).
3. Save Find a Prickle's answers as a check-in.

**Admin-facing (operations, incl. churn reduction)**
1. Member merge log with exact undo.
2. Prickle check-in patterns page (reach-out prompt).
3. Host-facing: let a prickle's host report unmatched Zoom attendees (member-facing, scoped write path needed).

**User experience**
1. Return-to after session expiry mid-form, and origin-aware back links.
2. Basic date format localization (non-US hedgies).
3. Show on Settings when a channel can't reach the member.

**Developer experience** (speed and tooling: CI time, agents coordinating)
1. Re-introduce test parallelism.
2. Coverage floors for `app/(admin)` and `app/(member)`, plus a ratchet.
3. Test Slack at the HTTP level with MSW.

**Tech debt and code quality**
1. Move the remaining hand-rolled sends onto `createNotifier` (staff-channel posts as admin notification kinds).
2. Turn the React Compiler lint rules back on from `warn`.
3. Finish the pre-prickle-nudge rename; move the ~32 direct-import route tests onto `apiFetch`.

**Infrastructure and reliability**
1. Serialize or coalesce concurrent members/attendance reprocessing (advisory lock); a prerequisite for change propagation.
2. Make member merge atomic (one Postgres function); it runs about 20 writes with no transaction.
3. Downstream change propagation in the processing DAG.
Also: re-audit the public repo for private data (see Security).

**Costs**
1. Replace the per-event Slack activity rebuild (cost grows with the day's traffic).
2. Mux spending alerts have no API; keep a manual checklist as the course launches.

---

## Member Status Refinements

### Rename `members` to `contacts` _(Needs Scheduling)_
The `members` table holds everyone (leads, active, on hiatus, cancelled), so "member" is
the wrong word for most of its rows. Its ids are being converted to short prefixed text ids
(`cnt_...`, "contact", the name HubSpot, Intercom, Mailchimp and Kajabi use for the same
unified entity), so the prefix already says what the table should be called. Rename the
table, `member_id` columns, API routes, types and docs to match. Do it as its own change:
a rename touches the same ~50 foreign keys, views and policies as the id conversion, so
keep it separate from that one. "Member" can stay as the UI word for `status = 'active'`
people.

### "Former BFF"-Style Labels
Single-product former-member labels need the `member_products` table (see Kajabi Data Expansion), not a `status` value.


### Guest Attendance Tracking (Deferred)
Some people who attend prickles have no Kajabi footprint at all (not a member, trial, or lead) — e.g. a guest brought by a member. Tracking them would mean creating member-like records for people who never appear in any Bronze source.

**Why deferred:** Different problem from member status/matching — the whole pipeline assumes attendees resolve to a `members` row derived from Kajabi. Guests break that assumption and need their own identity/record model rather than a fix to existing matching logic.

### Program Cohorts: Still Open
- **Self-Editing Academy's level-within-cohort progression.** The cohort moves together through 3 levels, plus a flexible "stay in the previous level" option; rules are TBD, needs a conversation with Ania before modeling. Today's schema tracks one shared cohort window, not levels.
- **Broader direction (not scoped):** first-class local data for `courses`, `events` and other Kajabi "products", plus a sync to keep them current: part of an eventual move away from Kajabi as the source of truth.
- **Ad-hoc Kajabi Payments subscriptions aren't reconciled.** Some members pay through a custom product in Kajabi's Payments/Billing area (subscriptions/invoices, not the Offers catalog the sync was built around), so reconciliation shows them as `cancelled` despite an active paid subscription. Stopgap: a `gift` override per member. Real fix: sync Kajabi's Payments API.
- Matching rule worth remembering: the date that decides whether a purchase falls in a cohort window is `created_at_kajabi`, falling back to `effective_start_at` only when null, never both (`lib/kajabi-cohort-matching.ts`).


---

## Data Import

### Silver Change Propagation in the Processing DAG
- **Where:** `lib/processing/trigger.ts` (`SILVER_DEPENDENCIES`, `getProcessingOrder`, `triggerReprocessing`)
- **Today:** a Bronze/Local change selects the Silver steps that read that table, and Silver→Silver edges only order the selected steps ("if both run, members and calendar before attendance"). Since 2026-09-29, an edge no longer pulls in an unselected upstream step (it used to, so every Slack webhook event rebuilt all members).
- **Missing half: downstream propagation.** When an upstream step's output changes, the steps that read it don't rerun. A Kajabi import that adds a member should re-match that member's past Zoom attendance and Slack activity. `getDownstreamSilverTables` exists but is unused. Instead:
  - `app/api/process/members/route.ts` hard-codes a 90-day attendance reprocess in `after()` at the end of every members rebuild.
  - Nothing reprocesses Slack after members change, so a new member's Slack messages stay unmatched until something else reprocesses Slack.
  - `getAffectedSilverTables` special-cases `calendar_events` → attendance.
- **Fix:** make propagation part of the graph. When a step runs, its downstream steps run in the same pass, in topological order, over the same date range (members → attendance and Slack; calendar → attendance). Then remove the hard-coded attendance reprocess and the `calendar_events` special case. Changes to Slack messages/reactions and Zoom attendees stay local, since nothing is downstream of `slack` or `attendance`.
- **Later refinement:** cascade only when the upstream step actually changed rows (each step reports whether it did), so a members rebuild that changes nothing costs nothing downstream.
- **Cause of the members deadlocks / statement timeouts** (see "Members Reprocessing Deadlocks / Statement Timeouts on Concurrent Webhooks", noted in PR #27 review): before the 2026-09-29 fix, every Slack message/reaction webhook and every Zoom import ran a full members rebuild, and each members rebuild then ran the hard-coded 90-day attendance reprocess. A burst of events (e.g. the bot joining 16 channels during an import) ran many at once and hit statement timeouts (`57014`) on `reprocess_members_atomic`. Webhooks no longer start members runs, but members can still run concurrently (Kajabi import + nightly reconcile + a Slack import's user rebuild), and so can attendance (several Zoom `meeting.ended` events). Propagation must not reintroduce the pile-up: serialize or coalesce concurrent runs of the same step (e.g. a Postgres advisory lock), as that entry suggests.

### Slack Webhook: The Per-Event Activity Rebuild Doesn't Scale _(Resolved 2026-10-29)_
Every Slack event used to rebuild a whole day of Slack `member_activities` (`reprocess_slack_activities_atomic`), after loading and matching every member in TypeScript. Production logs (2026-10-29) showed it failing a few times a day with `57014 canceling statement due to statement timeout`: the reads take ~100 ms, so the 8 s was bursts of events rebuilding the same rows at once and queuing behind each other's row locks (and it would have grown with every message once chat is busy). **Resolved:** the webhook now calls `slack_activity_project_message(channel, ts)` (`supabase/migrations/20270227000000_slack_activity_per_message.sql`, `lib/slack-activity-projection.ts`), which re-derives the activities of that one message and its reactions under an advisory lock on the message: constant cost, events about different messages never touch the same rows, two about the same message never insert twice. Same rules as the windowed rebuild (no text for DMs, group DMs or restricted channels, same engagement values, nothing for notices, deleted messages or removed reactions), checked by `tests/api/reprocessability/slack-activity-message.test.ts`, which compares its rows with the windowed function's. The Slack user to member map comes from `chat_slack_authors` (what the chat projection keeps from the same matching). **Still open (small):** a Slack user who appeared since the last full projection has no activity until the next rebuild (the nightly one); the windowed rebuild (imports, restriction changes, nightly) and a per-message event on the same message at the same instant could briefly insert both, which the next rebuild of that day removes.

### On-Demand Incremental Fetch for Every Source
Rule (CLAUDE.md, "Nothing through webhooks alone"): nightly reconciliation is the guaranteed path; webhooks and incremental fetches only reduce latency. Add a targeted incremental fetch per source so gaps heal in minutes instead of by the next nightly run:
- Slack: **done (2026-10-22)**, see `docs/SLACK_BRIDGED_CHAT.md` phase 3 part 11 (`lib/chat/gap-fill.ts`): an event for a message we don't have fetches that message (and its thread root), a reply with no root fetches the thread, and opening a bridged conversation catches it up, all coalesced and recorded in `chat_gap_fills`.
- Zoom, Google Calendar, Kajabi: equivalent "fetch since the newest record we have" paths, triggered on demand (webhook gaps, admin button, page views).
- Record each gap-fill (source, scope, rows recovered) and surface it on `/admin/data-health`. A fill that recovers many rows means the webhook was down. Checkly can't see this: it monitors endpoints and heartbeats, not processed requests or logs. (Slack's are at `/admin/data-health/gap-fills`; the other sources record into the same table when they get their fills.)

### Secondary Zoom Rooms _(Needs Scoping)_
We have a couple of secondary Zoom links/rooms that aren't imported. The Zoom import (`lib/zoom/client.ts`) reads one host's meetings (`ZOOM_USER_EMAIL`), and everything downstream assumes prickles run in that host's room, one meeting at a time. Checked against prod on 2026-10-03: all 417 imported meetings in the last 60 days had the same `host_id`, and only 1 pair of them overlapped in time. The main room's meeting id also changes roughly monthly.

What relies on that, and what to change when a second room is imported:
- **Attendance** (`app/api/process/attendance`): matches a Zoom meeting to scheduled prickles by time overlap alone (`findOverlappingPricklesInMemory`). Two rooms running at once would both match the same prickle, and a social room's attendees would count as attending a writing prickle. It needs a room → prickle (or prickle type) mapping, e.g. a meeting id or host per type, and that mapping must survive the monthly meeting id change.
- **Live presence** (`lib/zoom-presence.ts`, `bronze.zoom_participant_events`): the participant webhooks may already arrive for every room on the account. `loadPresenceByMember` only counts events from hosts seen in `bronze.zoom_meetings` (`host_id`), so secondary rooms are ignored today. Once one is imported, that filter lets it in, and presence needs the same room → prickle mapping, since it currently treats being in any covered meeting during a prickle as being at that prickle.
- **Check-out DMs** (`dueCheckoutMembers` in `lib/prickle-checkin-dms.ts`): inherit both of the above.
- **PUPs**: unscheduled time in a secondary room would become PUPs, which may or may not be wanted.

### Auto-post the daily #prickle-times update _(Needs Scoping)_
Today a person posts "Remaining Prickle Times for TUESDAY, JULY 21" in #prickle-times each morning: the day's remaining prickles (time, type, host as a mention, "HEADS DOWN" for hostless writing sessions) plus the Zoom link, meeting ID and passcode. The monthly passcode change means updating that post template by hand, so post it from the Hub instead, from the same Zoom setting the check-in DMs and calendar feed use (`prickle_join_settings`, edited at `/admin/prickle-join`, `lib/prickle-join.ts`).

- **Job**: a cron route (see `/api/internal/*`, wrapped in `withCronHeartbeat`) that runs each morning in `ORG_TIMEZONE`. Idempotent per day: record the posted day and message `ts`, so a retry or overlapping run never double-posts.
- **Content**: that day's prickles from `prickles` (start time at or after the post time, non-cancelled), hosts mentioned by Slack user id (`slack_identities`/`slack_users`), the join link and passcode from `joinAt(settings, <the day>)`. The existing post says "All times in EST", so check what time zone it should name.
- **Post**: a staff-style channel post, so it stays a direct `chat.postMessage` (a shared room, not a member notification; see the exceptions in CLAUDE.md). The channel is config: the channel name in `app.config.ts` like `SLACK_INTRO_CHANNEL`, resolved to an id. Needs `chat:write` (and `chat:write.public` or the bot invited) in `slack-app-manifest.yml`.
- **Open questions**: keep the existing text ("Wanna prickle at a time not posted? ...") verbatim? Post earlier-than-morning prickles for the next day? Edit the post when a prickle is added or cancelled later in the day? Does the one-off or irregular event (monthly goal review) go in it? Pop-ups hosted in secondary rooms need the "Secondary Zoom Rooms" item above.
- **Test**: with the fake clock (`useFakeClock`), post once per day, skip a second run, and use the link in effect that day. Include a test with more than 1000 prickles' worth of pagination only if the query isn't date-bounded.

### Kajabi Data Expansion

**Current state:** Kajabi API sync (`/api/sync/kajabi`, runs daily at 3am via Vercel Cron) fetches contacts, customers, purchases, and offers into Bronze, then processes Silver. Goal is to own the full member lifecycle.

**Products catalog (next step)**
- Create `kajabi_products` table (manual catalog of ~10 known products)
- Create `member_products` junction table (historical product access)
- Update member processing to populate `member_products` from `kajabi_purchases` + `kajabi_offers`
- Known products to seed: Quill & Cup Membership, 180 Program, Mindset Training, Self-Editing Academy, BFF Program, Hedgies on First Orientation, Chicago Retreat
- Enables product-based queries: "Show all members with 180 Program", "When did member join/leave BFF?"

**Transaction history (future)**
- Kajabi API: `/v1/transactions` (if available on plan)
- Bronze table `kajabi_transactions`, Silver rollup for LTV / revenue analytics

**Lead & engagement tracking (future)**
- Form submissions, opt-in reports, product progress — lower priority until core member/financial data is solid

---

### Importing Kajabi per-lesson progress _(Needs Scheduling)_
Members partway through a Kajabi course should arrive in the Hub with those lessons marked complete in `lesson_progress`. **Resolved (2026-10-28):** Kajabi's public API has no progress, but the admin's Product Progress report CSV (percent of the product per student, logins, start date, last activity) is imported into `bronze.kajabi_product_progress` from the admin Import Data page; see `docs/COURSES.md`, "Product Progress report import". **Resolved (2026-10-30):** the per-lesson capture (`courses:content --progress`) and the insert-only Silver step (`POST /api/process/course-progress`) are built and merged. A dry run on a 41-student product captured every student (2,132 lessons listed, 0 failed, 0 lessons missing from Bronze), after two fixes the probe could not foresee: the roster report is built in the background, and the per-student request needs the headers the page's own requests carry. **Still open:** run `--apply` and then the Silver step (dry run first) for Self-Editing Academy when it moves; an admin button for the Silver step; roster paging for a much larger product (unknown); and the member-confirmed percent catch-up below for courses with no per-lesson data.

### Catch-up from imported Kajabi progress _(Needs Scheduling)_
The Kajabi Product Progress import stores only a percentage per student, which cannot say which lessons were done, so nothing writes `lesson_progress` from it. **Why deferred:** it belongs with the Self-Editing Academy migration, when the course exists in the Hub. **What to build:** on the course outline, a member with access, a row from `memberProductProgress()` (`lib/courses/product-progress.ts`) and no Hub progress sees what Kajabi said (for example "Kajabi shows you at 62%") and confirms "mark everything up to here as done" (a lesson or module picker, defaulting to the lessons that make up that share of the course). It writes ordinary `lesson_progress` rows as the member, insert-if-absent, marked as imported/self-reported, with no `member_activities` rows. **Decided:** these completions count toward badges and course-completion nudges. Needs the course's lesson order and a decision on how a percentage maps to lessons (by count or by video length).

### Course videos: a cleanup page for unused and long-draft videos _(Idea)_
Every video in Mux is billed for storage by the minute (about $2/month for the Ready Writer's ~650 minutes, `docs/COURSES.md`), and nothing today tells staff which uploads are no longer earning their keep. An admin page (under the Courses area, behind the `courses` flag) would list two kinds:

1. **Not used in a lesson.** A `videos` row that no `course_lessons.video_id` points at: the old asset after a lesson's video was replaced (the plan retires it "once nothing references it"), a lesson that was deleted in Kajabi, or a duplicate upload. `video_id` is `ON DELETE SET NULL`, so these accumulate quietly.
2. **Only in draft for N months.** A video whose lessons are all hidden (Kajabi drafts) and that was uploaded at least N months ago. N comes from a filter on the page (default 3 months, say). There is no "became a draft on" date today (a lesson's `updated_at` moves for any edit), so start with `videos.created_at` as the age, and say so on the page. A lesson that is only "Coming soon" doesn't count: those are planned and visible.

**Per row:** Mux asset id, duration, quality (`basic`/`plus`), status, uploaded on, the lessons that use it (linked, with their state), and the stored minutes, with a total at the top ("N videos, M minutes").

**Acting on it:** staff-only, and never automatic. A "Delete from Mux" button per row (and for a selection) that confirms with the minutes it frees, calls Mux's delete-asset API, then removes the `videos` row and its `video_text_tracks`. Refuse when a lesson still references the video (re-check at delete time, since a lesson may have been re-linked since the page loaded). Write each delete to the audit log. Deleting a draft's video means the lesson has to be uploaded again when it is published, so label that clearly.

**Notes:** the same page could also show videos stuck in `preparing` or `errored`. A matching page for `course_lesson_files` (copied PDFs no lesson lists any more) would follow the same pattern, though the files step already removes those itself.

### Video library: what I've watched, and a watch-later list _(Idea)_
Let a member see in the Hub which videos from the library they have watched, and bookmark the ones they want to watch. Not scoped yet: it is unclear whether "library" means the course lessons or a wider set of videos (replays, talks), so decide that first.

**Watched:** the data mostly exists for course lessons. `lesson_progress` has `completed_at` and `last_position_seconds`, and `video_watch_segments` records every stretch watched (`docs/COURSES.md`, "Watch tracking"). A "Watched" / "In progress" / "Not started" mark on each lesson or video in the list comes from those, not a new table. Completion today is the 90%-playhead rule in `LessonCompletion.tsx`; "90% of the video actually watched" from the segments is still open (`docs/COURSES.md`) and would make the mark exact. Nothing is written in sudo, so the marks are read-only there like the rest.

**Bookmarks:** a new Local table (say `video_bookmarks`: member, video or lesson, `created_at`, soft delete with `deleted_at`), writable only by the member and read-only in sudo, with a bookmark control on the lesson and library views and a "Watch later" list. Needs the table grants and a pgTAP test per `supabase-table-grants.md`, and `track()` events per the usage-analytics rule.

**Related, same area:** "Continue watching" on the dashboard and a per-member stats view are both listed as not built in `docs/COURSES.md`; this would share their reads. Start at `lib/courses/member.ts` and the lesson list pages.

### TrackBear Import Gaps

The TrackBear importer (Projects → "Import from TrackBear"; `lib/trackbear-import.ts`) brings over
projects, all progress, starting balances, covers, tags-on-entries, and single-project goals (with their
titles, descriptions and show-on-profile; re-importing fills these in on goals imported before Hub had them). It lists
everything else per import instead of silently dropping it. Closing these gaps needs Hub features first:

- **Cross-project goals** (a TrackBear goal counting all projects or several): `writing_goals.project_id` is already nullable, but nothing displays or computes a goal with no project, or with several.
- **Tag-filtered goals** ("only count entries tagged X"): no tag filter on `writing_goals`.
- **Habit cadences**: "every N days/weeks" (N > 1) and yearly habits; Hub habits are every 1 day/week/month.
- **"Any measure" habits** (TrackBear habit with no threshold): Hub habits need one measure.
- **Habit date ranges**: Hub habits are open-ended; imported habits' start/end dates are dropped.
- **Project "starred"**: no star on Hub projects.
- **Tag colors, unused tags**: Hub tags are plain labels on each entry.
- **Negative starting balances**: `writing_project_starting_balances` has `CHECK (amount >= 0)`.
- Habit weeks start Monday in Hub; TrackBear uses the member's setting (Sunday by default), so weekly streaks can differ.
- **Entry "last edited" time** (`updatedAt`): Hub entries only have `created_at`.
- **Covers**: kept at their original size as the member's own media library image (`lib/trackbear-cover.ts`); a cover that fails to copy (or is an SVG, which the library refuses) isn't retried on re-import (the project already exists), so the member has to upload it by hand.
- **Not in TrackBear's export at all** (would need their API or a TrackBear change): account-level lifetime starting balance, week-start and other settings, leaderboards.
- **One-click import**: TrackBear has no OAuth, and its API needs a member-created API key, so import is export-file upload. If TrackBear adds OAuth, switch to it.


### Educational Prickle Guest Speakers: Setup and Gaps

Educational prickles (`EDU-PRICKLE: Title w/Name`) map to the Educational type through `prickle_types.summary_aliases`, and the name after `w/` is stored as `prickles.guest_speaker` while the type's default host hosts (`prickle_types.names_guest_speaker`). Deferred:

- **Resolved:** someone other than the default host hosting. An admin changes a calendar prickle's host from its page; the choice survives reprocessing and the guest speaker from the title stays (`hostOverrideId` in `assignHostAndSpeaker`).
- **Titles that don't start with a known type name or alias** (a webinar titled "Quill & Cup [Topic] Prickle: ...") still go to the unmatched queue to be resolved by hand; once resolved, a speaker after `w/` or `with` is read as usual.

### Ambiguous Zoom Names: The Hygiene Count Still Reads the Stored Rows

The Ambiguous Zoom Names page works out from the current members and aliases which stored names are still ambiguous, and derives their counts from Bronze. The Data Hygiene overview (`app/(admin)/admin/hygiene/page.tsx`, `ambiguousNamesCount`) still counts the stored unresolved rows, so it can show more names than the page lists until the stale rows are resolved or ignored. Deferred to keep the fix small. Start by moving the "still ambiguous" check into a shared function in `lib/` that both call; `ambiguous_zoom_names.occurrence_count` and `candidate_member_ids` are no longer read and can be dropped afterwards.

### Import pre-2026 events _(Idea, very low priority)_

The past events page (`app/(member)/events/past/page.tsx`, `PAST_EVENTS_FROM`) hides events that start before 2026, because the older ones haven't been imported properly yet. Deferred until there is time to import them. Start by importing the older events, then remove the `PAST_EVENTS_FROM` filter.

## Infrastructure & Deployment

### Check that a Dropped Column Is No Longer Referenced
Squawk (`.squawk.toml`, run in the `Check migration numbering` job) fails any new migration that drops or renames a column, table or function, so a drop needs a deliberate, approved `-- squawk-ignore`. It reads only SQL: it can't tell whether the code still uses the column, which is how `member_books.genre` was dropped in the same PR that stopped reading it and took `/projects` down while the deploy rolled out. Add a script (next to `scripts/check-migration-order.ts`) that, for a migration carrying `squawk-ignore ban-drop-column` (also table and function), extracts the dropped name and fails if the same PR's tree still references it (grep `app/`, `lib/`, `components/`; ignore `lib/data/database.types.ts`, which `pnpm types:gen` regenerates), and a stronger variant that checks the previous production deploy's code instead of the PR's. Deferred because the lint plus the approval rule already stops the accident; worth doing if approved ignores start slipping through.

### Test Slack Integrations at the HTTP Level with MSW
Slack tests currently replace the `@slack/web-api` `WebClient` class with a hand-written fake (e.g. `tests/api/slack-sign-in.test.ts`). That skips the real client's request encoding, retries and error handling, and only returns the happy responses each test remembers to stub. Intercept `https://slack.com/api/*` with MSW instead (the shared server is already set up in `tests/setup-msw.ts`):
- A reusable Slack fake: handlers for `users.info`, `views.publish`, `chat.postMessage`, `conversations.*` that record calls and return realistic responses, including `ok: false` errors (`user_not_found`, `invalid_blocks`, `ratelimited` with `Retry-After`).
- Assertions on what was actually sent over the wire (form/JSON bodies, `Authorization: Bearer` token), not on mock call arguments.
- Migrate every Slack-touching test (sign-in, nudges, wheel of wonder, feedback, private channel access) and delete the per-file `vi.mock('@slack/web-api')` fakes.
- Keep the complementary layers: `@slack/types` typing on block builders, Block Kit limit tests (`tests/lib/slack-sign-in-blocks.test.ts`), real HMAC-signed webhook requests. Optionally, a nightly non-hermetic smoke test that publishes to a test user in a Slack developer sandbox workspace, since only Slack itself fully validates Block Kit.

### Enforce "Tier 2 Ids Are Never Exposed" _(After the Short IDs Scheme Lands)_
`CLAUDE.md` ("Resource ID Tiers") and `docs/SHORT_IDS_PLAN.md` say a Tier 2 table's id must never reach a user; today a reviewer has to catch it. Once the short id scheme is in place, add a check so a violation fails CI:
- Keep the tier lists in one machine-readable place (a small module or the `COMMENT ON TABLE ... 'id prefix: xxx_'` comments the migration adds), not just prose.
- A test that scans `app/**/[param]` route segments, `href` / `url` / `ref` builders in `lib/notifications` and `lib/channels`, Slack block builders and the calendar feed for ids that come from a Tier 2 table, with an explicit allowlist (each entry with a reason, like the admin-route test in `tests/components/pages/admin-auth.test.tsx`).
- Possible shortcut: a runtime guard in the link / notification helpers that rejects an id whose prefix is not a Tier 1 prefix.
- Add the Tier 1 promotion step (readable prefix, migration, tier list) to the PR checklist.

### Alert on Partial Failures in the Other Nightly Jobs _(Needs Scheduling)_
Only `/api/reconcile/slack` skips its Checkly heartbeat and posts to #hub-alerts when a run finishes with problems (`cron_partial_failure` in `lib/operations-alerts.ts`). The other reconcile routes (`calendar`, `zoom`, `members`, `logins`) and the `/api/internal/*` jobs still ping on any 200, so a Silver step that fails inside an import which answers 200 leaves the heartbeat green. Deferred because the Slack job is the one that failed in practice (statement timeouts in the 90-day import). To do: for each job, read the step results in its response, treat a failed step as a problem, and call `sendOperationsAlert` the way `app/api/reconcile/slack/route.ts` does; `triggerReprocessing` (`lib/processing/trigger.ts`) is where the swallowed failures come from.

### Rotate the Checkly Heartbeat Ping URLs _(Needs Scheduling)_
`checkly deploy` printed every heartbeat's ping URL into the public CI logs ("Ping URL of heartbeat check ... is https://ping.checklyhq.com/<id>"), and anyone holding one can mark that job healthy. **Resolved:** the deploy step pipes `checkly deploy` through a `sed` that replaces the id in `ping.checklyhq.com/<id>` with `***` (`checkly.yml`; `tests/lib/workflow-heartbeat-masking.test.ts`). It redacts by pattern rather than by value, so it also covers a new heartbeat's first deploy. **Still open:** the URLs already in old run logs stay valid. Rotating means recreating each heartbeat monitor (rename its logical id in `lib/cron-heartbeats.ts` so Checkly issues a new URL), copying the new URLs into `.env.prod` and `pnpm env:sync`, then deleting old runs' logs (`gh run delete`) if wanted. Do it together with the pre-prickle-nudges rename below, which already needs a new monitor.

### Log Member Merges So They Can Be Undone Exactly _(Needs Scheduling)_
A merge (`POST /api/admin/members/merge`) re-points everything from the absorbed member to
the survivor and then deletes the absorbed member, so nothing records what moved. Undoing
a wrong merge today is a heuristic: the Split button (`/api/admin/members/split`) and
`/api/admin/members/move-aliases` take the name and email aliases the merge left behind and
reprocess attendance, but they can't restore anything that isn't rebuilt from Bronze
(hiatuses, status overrides, program enrollments, hosting, append-only activities such as
writing progress, outreach touches and logins, and external ids copied to the survivor).
`audit_log` records most of those re-points as separate field changes, but nothing ties
them to one merge, `prickle_attendance` and `member_activities` moves aren't audited, and
the route runs about 20 unrelated writes with no transaction.

**Proposed:**
- A `member_merges` table, one row per merge, written in the same transaction as the
  merge: actor, time, primary id, and the absorbed member's full original row as JSON
  (including its id).
- A child `member_merge_moved_rows` table: `(merge_id, table_name, row_id)` for each row
  re-pointed, and the full row for anything the merge deleted because it collided with the
  survivor's (duplicate name aliases, duplicate cohort enrollments). Also record the
  external ids copied to the survivor and the `ambiguous_zoom_names.candidate_member_ids`
  arrays that were rewritten.
- Move the merge into one Postgres function so it is atomic and writes the log itself; the
  route (single and bulk merge both use it) just calls it. A failure partway then leaves
  nothing half-merged.
- An exact unmerge on top of the log: recreate the member with the same id, move the logged
  rows back, restore the deleted ones, put the copied external ids back, then reprocess
  attendance and Slack activity from Bronze. Offer it as an "Undo merge" action on the
  log entry (the log alone, with undo done by hand from it, is the smaller first step).
- Keep the log permanently (admin-read only; no member-facing exposure), so old merges stay
  undoable. The moved-rows table grows with a long-time member's attendance, still small
  next to `audit_log`.
- Needs the usual new-table work: grants in the same migration, RLS, pgTAP coverage, and
  the merge route's existing tests moved onto the function.

Keep Split and move-aliases as the fallback for merges made before the log existed (see
the removal item below).

### Remove Split and Move-Aliases Once the Merge Log Exists _(After "Log Member Merges")_
`POST /api/admin/members/split`, `POST /api/admin/members/move-aliases`, the Split button
and `SplitMemberModal` (`app/(admin)/admin/members/[id]/`) exist only to undo merges made
before merges were logged: they guess from the leftover aliases and rebuild attendance,
because nothing recorded what the merge moved. Once merges are logged and "Undo merge"
works, the only merges they could still help with are the old, unlogged ones, so they
become close to dead code. Remove them (routes, modal, button, their tests in
`tests/api/admin/members/` and `tests/components/`) once the unlogged merges that matter
have been checked and fixed, or after a set period with no use; whichever comes first.
Check the `audit_log`/activity feed for recent use before deleting.

### Refresh Admin Member Pages After Moving Aliases
Unconfirmed. After "Move ticked names and emails to ..." in the Split dialog, the source
member's Identity tab once kept showing the moved email briefly. It has not been reproduced.
The suspected cause is the client router cache, so `SplitMemberModal` calls `router.refresh()`
before navigating; whether that is needed is unknown. The routes do not call `revalidatePath`
(a route handler's call doesn't clear the client cache, so it was removed). Retry the repro
(move an alias, then open the source member's Identity tab); if it still happens, capture
what the page shows and when, and check whether the alias row is gone at that moment.

### Env Sync Never Deletes: Removed Variables Linger in GitHub, Vercel and Vault _(Needs Scheduling)_
`env-vars.config.ts` is the source of truth for what exists, but the sync scripts only add and overwrite (`scripts/sync-to-github.ts`, `scripts/sync-to-vercel.ts`, which removes a Vercel var only to replace it, and `scripts/sync-vault-secrets.ts`). Take a variable out of the config, or drop a destination from it, and the copy already synced stays where it is until someone deletes it by hand. This came up when the Checkly heartbeat URLs were briefly given a GitHub destination (PR #371, reverted in #378): seven GitHub secrets were left behind and had to be deleted manually. Config as code that can't say "this should no longer exist" has the problem Terraform solves with its state file.
- **Fix:** let each sync compute the diff between the config and what the destination holds. List the destination's names (`gh secret list` / `gh variable list`, `vercel env ls`, the Vault secret names), and report names that are present but not declared for it. Start with a read-only `--prune-check` that prints them (and fails in CI), then an explicit `--prune` that deletes them after a confirmation. Never delete by default: other things share these places (secrets set by hand, Vercel's own `VERCEL_*` and integration-managed vars, Supabase vault entries owned by Supabase), so scope to an allowlist or a naming convention, or keep a committed list of names the sync owns (the state file).
- **Also check:** GitHub Actions secrets and variables are separate lists (a `type` change from secret to config leaves the old kind behind), and Vercel has per-target copies.
- **Docs:** `docs/ENV_MANAGEMENT.md` and `.claude/rules/new-env-var.md` should say that removing a variable means running the prune, until it exists, deleting it by hand in each destination.

### Multi-Environment Setup
**Status:** Documentation created, awaiting implementation

**Setup Tasks:**
1. [ ] Add custom domain to Vercel project
   - Configure DNS records (CNAME or A record)
   - Wait for SSL certificate provisioning
   - Set as production domain

2. [ ] Create development Supabase project
   - Provision new project for dev/preview environments
   - Copy schema from production
   - Add test data

3. [ ] Configure environment-specific variables in Vercel
   - Production: Production Supabase credentials
   - Preview: Development Supabase credentials
   - Development: Development Supabase credentials
   - Separate or share external integrations (Zoom, Google, Kajabi)

4. [ ] Verify environment isolation
   - Test local development uses dev Supabase
   - Test preview deployments use dev Supabase
   - Test production uses production Supabase
   - Confirm no data leakage between environments

5. [ ] Optional enhancements
   - Add EnvironmentIndicator component to root layout
   - Use lib/config.ts for environment-aware behavior
   - Add environment info to settings/about page

**Documentation:**
- Setup guide: `docs/DEPLOYMENT_SETUP.md`
- Quick start: `docs/QUICK_START.md`
- Env files and syncing: `docs/ENV_MANAGEMENT.md`

**Benefits:**
- Safe testing without affecting production data
- Branch-based preview deployments for QA
- Clear separation of development and production
- Easier onboarding for new developers

### Audit Server Error Logging and Send Genuine Errors to Sentry

- [ ] Inventory server-side `console.error` calls. Reclassify expected outcomes (such as a member opt-out, absent optional integration, or rejected user input) as normal results or appropriate lower-severity logs; fix misleading error messages.
- [ ] After that audit, connect genuine server `console.error` events to Sentry centrally, with environment tags and protection against recursion, duplicate reporting, sensitive data, and alert floods. Keep explicit capture for caught errors until the central path is verified, then remove redundant one-off captures.
- [ ] Test one handled failure and one unhandled exception end to end in a preview deploy, and verify server logs, Sentry events, and alert-rule routing. See the alert-routing item below.

### Sentry Alert Routing _(Needs Scheduling)_

The Developer plan cannot install Sentry's Slack integration. Failed notification DMs and
ambiguous Slack member matches now alert directly from the app (see
`docs/SLACK_OPERATIONS_ALERTS.md`), while their Sentry events and server logs remain.

- [ ] Verify Billie Bot can post in `#hub-alerts` and run an end-to-end production test of
      channel delivery and the `ALERTS_EMAIL` fallback before broad Slack rollout.
- [ ] Decide how to route other Sentry errors. Events have `production` / `preview`
      environment tags (`NEXT_PUBLIC_SENTRY_ENVIRONMENT`), so Sentry issue alerts can filter
      by environment. Sentry email actions target members rather than arbitrary addresses;
      the Slack integration needs a paid plan.

### Migrate to Tailwind CSS 4 _(Blocks 28 `npm audit` Findings)_
**Status:** Not started (added 2026-10-21)

The app is on Tailwind 3.4 (`tailwind.config.ts`, `@tailwind` directives in
`app/globals.css`). `npm audit` still reports 28 findings (3 moderate, 25 high) after
`npm audit fix`, and `npm audit fix --force` would clear most of them only by moving to
Tailwind 4. They trace to `braces` (via tailwindcss 3 → chokidar/fast-glob/micromatch, and
the `vercel` CLI's ts-morph chain) and `postcss-selector-parser` (via
`@tailwindcss/typography` and postcss-nested). All are denial-of-service advisories in
build/dev tooling that only processes our own source, so the real risk is low, but the
audit stays red until this lands. The `vercel` CLI chain may stay flagged either way.

CLAUDE.md already describes v4 features (`@theme`, built-in container queries), so the docs
are ahead of the code.

- [ ] Run `npx @tailwindcss/upgrade` on a branch: config moves into CSS (`@theme`,
      `@plugin`), `@tailwind` directives become `@import "tailwindcss"`, PostCSS uses
      `@tailwindcss/postcss`.
- [ ] Load `@tailwindcss/typography` through `@plugin`; check it still resolves.
- [ ] Review renamed utilities and changed defaults (border/ring colors, `shadow-sm`,
      `rounded-sm`) for visual changes.
- [ ] Check every page at widths either side of each breakpoint (see CLAUDE.md,
      Responsive Layout) and in dark mode.
- [ ] Confirm the supported-browser floor (Safari 16.4+, Chrome 111+, Firefox 128+) is
      acceptable.
- [ ] Re-run `npm audit` and record what remains.

### Un-pin CI Runners from ubuntu-24.04
**Status:** Pinned 2026-09-24, needs revisiting after 2026-11-19

`.github/workflows/ci.yml`, `checkly.yml`, and `auto-merge.yml` all pin
`runs-on: ubuntu-24.04` instead of `ubuntu-latest`, added to avoid flaky CI during
GitHub's gradual, non-deterministic rollout of `ubuntu-latest` → Ubuntu 26.04 between
Oct 19 and Nov 19, 2026 (`actions/runner-images#14748`).

- [ ] After the rollout completes (~2026-11-19), deliberately test the `test-db` job
      (Docker/Supabase-based, most likely to be sensitive to the kernel/systemd bump)
      against `ubuntu-26.04` explicitly on a branch before switching the pin.
- [ ] Once verified, either switch `runs-on:` back to `ubuntu-latest` (now pointing at
      26.04) or pin directly to `ubuntu-26.04` — same tradeoff as today's choice.

### Re-introduce Test Parallelism
**Status:** Deliberately disabled (2026-09-22), needs a real fix

`vitest.config.mts` sets `fileParallelism: false` because test files running concurrently
against the shared local Supabase instance were racing each other (colliding fixture
names, cross-file data pollution) and causing spurious failures unrelated to real bugs.
Disabling parallelism fixed that but costs real time -- the full suite is already at
~100s and creeping toward the 2-minute mark as more tests are added, which matters once
this suite is gating CI on every PR.

**Real fix options to investigate:**
- [ ] Wrap each test in a transaction that rolls back at teardown, so parallel tests never
      see each other's writes (the standard pattern for this class of problem)
- [ ] Give each parallel worker its own isolated schema/database instead of sharing one
- [ ] Audit remaining shared-fixture-name collisions (e.g. generic "Test Member" style
      names reused across files) and make them unique per file/run as a cheaper partial fix

Don't just flip `fileParallelism` back to `true` without one of the above -- that's what
caused the pollution/flakiness in the first place.

### Set the Checkly heartbeat URL for the retention job _(Needs Action)_

`/api/reconcile/retention` (the nightly job that keeps the device and removes raw IPs and browser strings after 90 days) is deployed with a heartbeat registered in `lib/cron-heartbeats.ts` (`reconcile-retention`), but `pingCronHeartbeat` does nothing until its env var is set, so a failed or missed night alerts nobody. Adding the monitor needs more uptime monitors than the Checkly plan allows (10, all in use), and the upgrade goes from $0 to $24/month (2026-10-31), so it is held. Every `checkly deploy` since the job landed was refused for that reason, and the job still showed green until the pipefail fix. To make room without paying, the separate SSL certificate monitor was removed: the alert channels' SSL-expiry alert (`sslExpiry` in `__checks__/alert-channels.ts`, 30 days ahead) already watches the app's certificate through the Mux API checks, which request the app host. Once that deploys, the retention monitor is created and the steps at the end of this entry apply.

If the plan stays as it is, cheaper partial cover for the failure case (not for a night that never runs): report the route's caught error to Sentry (`Sentry.captureException` in the `catch` of `app/api/reconcile/retention/route.ts`, with an alert rule), and glance at the route's `[Reconciliation] Retention complete` log line in Vercel after a deploy. When upgrading: deploy the checks (`__checks__/cron-heartbeats.check.ts` builds one monitor per entry), copy the new monitor's ping URL into `.env.prod` as `CHECKLY_HEARTBEAT_RECONCILE_RETENTION`, and run `pnpm env:sync` (see the header of `lib/cron-heartbeats.ts`). The date that matters is 2027-01-16, when the first raw value is old enough to be removed.

### Point the old marketing site's privacy-policy link at `/privacy` _(Needs Action)_

The former policy lived at `/privacy-policy` on the marketing site (a separate site, not this app) and is probably linked from its footer, checkout and sign-up flows. `/privacy` is now public and is the policy. Until the links are updated, visitors from those pages read the old text, which no longer matches what the Hub collects. Needs someone with access to the marketing site: change each link to the Hub's `/privacy`, or redirect the old path. Nothing to change in this repo.

### Re-check the providers' privacy certifications each year _(Needs Scheduling)_

The services section of `/privacy` says each provider is certified under the EU-U.S. Data Privacy Framework (and its UK extension) or that we rely on standard contractual clauses. That was checked on 2026-10-30 against the Data Privacy Framework list: every provider is active except Supabase, which relies on the standard clauses in its data processing addendum (incorporated into its terms, so nothing to sign). Certifications have to be renewed: Google's next due date is 2027-09-13, and Resend is marked "re-certification under review". Look them up again (dataprivacyframework.gov, participant list) each autumn and whenever a provider is added, and reword the sentence if one lapses. Start: `app/privacy/page.tsx` (services section) and its test.

### Unmask more of Session Replay if recordings are too opaque _(Needs Decision)_

Replays keep Sentry's defaults (all text, form fields and media masked) except the member and admin navigation and the tab bars, which carry `data-sentry-unmask` (`instrumentation-client.ts`, `components/Tabs.tsx`, `components/MemberNavigation.tsx`, `app/(admin)/admin/AdminNavigation.tsx`). That shows where someone went, not what a screen said. Deferred until someone has watched real recordings and knows what is missing. Add the attribute to specific components, never a blanket `unmask` selector: headings and buttons can hold a member's name (the user menu button does), and chat, notes and profile text must stay masked. Whatever is unmasked stays true to the "text and form fields masked" wording on `/privacy`, so reword it if the approach changes.

### Read the rollups for ranges past 13 months _(Due before late 2027)_

Usage events older than 13 months are removed once rolled up (`analytics_rollups`, `lib/retention/usage-events.ts`), but the admin analytics pages and their SQL functions (`analytics_funnel`, `analytics_event_summary`, `analytics_top_clicks`, `analytics_notification_rates` and the rest) read `analytics_events` only. The first events reach 13 months in late 2027 (the oldest are from 2026-10-20); from then a range that starts earlier would silently show only the last 13 months. Before then: have those reports read `analytics_rollups` (total, route, control and action dimensions by day, week or month) for the part of a range older than the cutoff, say on the page where a figure comes from rollups (no per-visit funnels from them), and decide whether any report that needs combinations (route by screen size) justifies a combination set with a minimum cell size.

### Raw browser strings in push subscriptions and feedback _(Needs Decision)_

The nightly retention job (`/api/reconcile/retention`) removes the raw IP and browser string from the visit log, the usage log and course viewing after 90 days, which is what the `/privacy` row says. Two other places keep a raw user agent and are deliberately not covered: `push_subscriptions.user_agent` (the device label in Settings > Notifications, kept while the subscription is) and the user agent a member's feedback submission carries (`app/api/feedback/route.ts`, for support to reproduce a problem). Decide whether to store only the parsed device (`lib/device.ts`) in the first and remove the second after 90 days, or leave both and name them on the page.

### Two flaky tests on `main` _(Resolved)_

Both failed CI on unrelated PRs on 2026-10-30 and passed on a re-run of the same commit.

- **Resolved: `tests/api/data/member-repository.test.ts`, "searches names and emails..."** (db project). The failing assertion was not the two-word one: the CI log of the first attempt on `main` after #610 points at the `words: ["100%"]` line. `search` turns `%` into a space, so that is a search for `100`, and a Supabase run gives its members emails stamped with `Date.now()` and a random suffix, which contain `100` a few percent of the time, so all three members matched. Repeated `.or(...)` parameters are ANDed by PostgREST and `search` is correct. The contract now uses letters-only tokens (`fqzvern`, `qzvhalf%`) that cannot occur in a generated email.
- **Resolved: `tests/components/AdminDisplayNames.test.tsx`: "window is not defined"** (unit project). The host field's `onBlur` in `UnmatchedEventsTable.tsx` started a 200 ms `setTimeout` that outlived the test. The timer is now kept in a ref and cleared on unmount (and on refocus); a test asserts no timer is pending after unmount.
- **Resolved: the other unmanaged `setTimeout(() => setX(false), ...)` calls** in `Wheel.tsx` (two), `CalendarSyncCard.tsx`, `HostVibePanel.tsx`, `components/chat/MessageActions.tsx`, plus three more found by grep: `components/search/SearchPalette.tsx` (copied-query tick), `AliasSearchForm.tsx` and `MatchingGame.tsx` (clear matches after save). They now use the shared `useTimeout()` hook (`components/useTimeout.ts`): one pending timer per use (starting again replaces it), cleared on unmount. Each has a test that asserts the timer count before and after unmount.
- **Still open:** none. Left alone on purpose: `ProcessOrphanedButton.tsx` / `ProcessOrphanedMeetingsButton.tsx` (a timer that only calls `window.location.reload()`, no React state) and `GroupedTable.tsx` (a 150 ms `scrollIntoView`, no state). New `setTimeout`s that set state in a client component should use `useTimeout()`.

### Test Framework Follow-ups
**Status:** Ideas from the coverage work (PR #77); none started

Context: API route tests run in-process through `apiFetch` (`tests/helpers/api-fetch.ts`) so
`app/api` coverage counts, and per-area floors on the combined unit + db numbers live in
`AREA_FLOORS` (`scripts/coverage-report.ts`). Combined, 2026-10-14: lib ~86% lines, components
~72%, `app/api` ~59% (46% branches), `app/(member)` ~56%, `app/(admin)` ~19%.

- [ ] **Floors for `app/(member)` and `app/(admin)`.** Neither has one; `app/(admin)` is the
      biggest gap in the repo. Add the floors once a round of page tests lifts them.
- [ ] **Ratchet the floors.** `AREA_FLOORS` sits ~2 points under the baseline and only moves
      by hand. Have the coverage report note when an area is more than ~3 points over its
      floor, so floors follow the numbers up.
- [ ] **Cover the weakest `app/api` routes.** The coverage report's per-file data shows which
      handlers have the most uncovered statements and branches; start with the biggest.
- [ ] **Move the ~32 direct-import route tests onto `apiFetch`.** They call the handlers
      themselves and mock `next/headers` per file. One shared helper removes the mocks.
- [ ] **Audit fire-and-forget mocks for the race fixed in `slack-message-subtypes.test.ts`.**
      A mocked `after()` that does `void callback()` can land in the next test after its
      `vi.clearAllMocks()`. Grep the tests for `after:` mocks and `void` callbacks; make them
      collect their promises and have the test await them.
- [ ] **Automate `pnpm github:config:push`.** It runs by hand because `GITHUB_TOKEN` can't
      manage rulesets. Worth a CI job with an admin-token secret only if the ruleset changes
      often; at minimum a scheduled `github:config:diff` to flag drift.
- [ ] **Clear the remaining uncleared `setTimeout`s.** An uncleared timer that fires after its
      component unmounts sets state on a torn-down DOM; in a test that's an unhandled
      `window is not defined` that fails a run in which every test passed, only on slow runs. #97
      fixed the dropdown-close timer in four search boxes (`lib/hooks/useBlurDelay.ts`). Left, same
      class, lower risk: the blur close in `UnmatchedEventsTable`
      (`app/(admin)/admin/data/prickle-types/`, its own `showHostDropdown` state; `useBlurDelay`
      fits), and the "Saved" / "Copied" flashes in `HostVibePanel` (`setSaved`), `CalendarSyncCard`
      (`setCopied`) and `wheel-of-wonder/Wheel.tsx` (`setJustRevealed`, `setStarterCopied`). Keep the
      timer id in a ref and clear it in an unmount effect, and add a test that triggers it, unmounts
      and expects `vi.getTimerCount()` to be 0 (see the blur tests in
      `tests/components/EntitySearch.test.tsx`). Then grep `components/` and `app/` for any other
      `setTimeout(` that sets state without a cleanup; `SearchPalette` (copied), the hygiene
      buttons, `MatchingGame` and `AliasSearchForm` also use one and weren't checked.

### Support Preview Environments
**Status:** Not started — needs scoping

Right now every merge goes straight to `main`; PR-based Vercel preview deployments have
never really been used (confirmed: `vercel.json` has no preview-specific config, and
there's no workflow that opens PRs instead of merging worktree branches directly). Making
previews actually useful means:

1. [ ] Make Vercel preview deployments work properly with a real PR workflow (currently
       blocked on habit/workflow more than tooling -- previews already happen automatically
       on any branch push once PRs are actually used).
2. [ ] Fix all secrets/env vars for the preview environment, and **disable anything that
       causes real-world side effects from a preview**: outbound Slack messages, Kajabi/Zoom
       API calls, billing-triggering webhooks, email sends, cron jobs. A preview should never
       be able to notify a real user or incur a real charge.
3. [ ] Evaluate [Supabase branching](https://supabase.com/docs/guides/deployment/branching)
       (native per-PR ephemeral DB branches) as the mechanism, instead of the single static
       `.env.preview` Supabase project previews currently point to. Note: that existing devel
       project has no migration-push path today at all (`supabase/config.toml` only has
       `[remotes.prod]`, and `package.json` only has `db:push` targeting `.env.prod`) --
       worth confirming whether Supabase branching solves this automatically or whether it's
       a separate gap either way.
4. [ ] Run Checkly browser checks against each preview URL, including key flows like login --
       this is the "deploy-check" capability discussed when Checkly was first set up, deferred
       specifically pending this preview-environment work landing first.

### Support a Long-Lived Devel Environment
**Status:** Not started — needs scoping

A persistent (not per-PR-ephemeral) staging environment, sitting between preview and
production:

1. [ ] Add a persistent Supabase branch for devel (see Supabase branching link above --
       distinct from today's single static `.env.preview` project, if branching replaces it).
2. [ ] Same secrets/notification-disabling work as preview environments above -- no real
       Slack/Kajabi/Zoom/billing side effects from devel either.
3. [ ] Clarify the relationship to Supabase DB branching from the preview-environments work
       above -- likely the same underlying mechanism, but confirm rather than assume.
4. [ ] Checkly checks against the devel branch too (same browser-check coverage as preview).
5. [ ] Update the git workflow and CI (`.github/workflows/ci.yml`) to a real promotion
       pipeline: deploy to devel first, run tests, a bake/soak period, then promote to
       production -- rather than today's single `main`-branch-direct-to-prod pipeline.

### Mux configuration as code (`mux:config`) _(Built; follow-ups open)_
**Resolved:** `mux-config.yml` + `pnpm mux:config:diff` / `:push` (and `:dev` variants for a developer's own tunnel webhook), `scripts/mux-config.ts`, pure logic in `lib/mux-config.ts`, docs in `docs/MUX_CONFIG.md`. It manages the production webhook (`<APP_URL>/api/webhooks/mux`, signing secret saved to the env file, never printed, never overwritten without `--replace-secret`) and the one playback restriction (production host, `*.vercel.app`, `localhost`). Run by hand, not by CI. A nightly Checkly check (`__checks__/mux-e2e.check.ts`) confirms the webhook rejects unsigned calls and, once the separate "checks" Mux environment's values are set, that a signed token gets a manifest and no token gets 403. Spending alerts have no API (dashboard checklist in `docs/MUX_CONFIG.md`).

**Still open:**
- **Enforce the restriction.** It only applies to tokens carrying `playback_restriction_id`; `signPlaybackTokens` (`lib/mux.ts`) doesn't add it. Needs the restriction id in a non-secret env var (per environment), passed as a claim, checked in a real browser on production and a preview before shipping (a wrong domain list blocks every member's video).
- **Read the production webhook.** Listing webhooks needs a System-permission token (`MUX_SYSTEM_TOKEN_ID/SECRET` in `.env.prod`), so the first diff couldn't confirm the webhook; the restriction part was compared with the app token.
- **Webhook delivery check.** The nightly check can't prove Mux reaches us; that needs a throwaway asset created in the environment each run (a few cents a month) and polling the `videos` row, or a Mux "send test event" if one appears in the API.
- **Signing keys** are created by hand (the private half is shown once); `/system/v1/signing-keys` could list them for a drift check.

### Google Calendar push channel: create and renew it _(Built; follow-ups open)_
**Resolved:** `/api/reconcile/calendar` (nightly) opens and renews the watch channel in production (`lib/google-calendar/watch.ts`, table `calendar_watch_channels`, `docs/WEBHOOK_SETUP.md`), so a calendar edit reaches the prickle schedule in seconds; the nightly sync stays the guaranteed path, and a failure to open the channel fails the cron (no heartbeat). The webhook rejects every request unless `X-Goog-Channel-Token` matches `GOOGLE_CALENDAR_WEBHOOK_TOKEN`.

**Resolved since:** a notification now fetches only what changed since a watermark (`events.list` `updatedMin`, `calendar_sync_state`) and reprocesses just those dates; concurrent notifications coalesce into one rerun (`lib/google-calendar/incremental-sync.ts`). `/admin/calendar` refreshes itself when a prickle in the week on screen changes (`prickles` is published to Supabase Realtime; `components/LiveRefresh.tsx`). The member calendar and other prickle lists don't have it yet; reuse `LiveRefresh`. A deletion of any event, however old, is caught: cancelled events are listed with no date window, in the push sync and in a sweep the nightly reconcile runs (`sweepCancelledEvents`, last 8 days, `?cancelledSinceDays=N`). Verified end to end on production: a Google edit shows on an open `/admin/calendar` in about 12 seconds without a reload.

**Still open:**
- Updates (new, renamed or moved events) are only kept inside the watched window, 90 days back to 90 days ahead, the same as the nightly import; only deletions look further. An edit to an older or further-out event is ignored until the window is widened. Decide the window before relying on far-future scheduling.
- A push sync logs only its summary (`Calendar sync from webhook`). Log how many events Google returned and the timing of each step, so a missing event can be told apart from a slow sync without guessing.
- An event created on the wrong Google calendar (a personal one) is silently never synced. The admin could be shown the newest event Google returned and when, on `/admin/data-health`, so it is clear whether the sync saw it.
- `updatedMin` with `singleEvents` is assumed to surface every instance of an edited recurring series; check against real edits and fall back to Google's `syncToken` if instances are missed. The nightly full sync covers any miss.
- Record each webhook-triggered sync as a gap-fill per "On-Demand Incremental Fetch", and show channel age/expiry on `/admin/data-health`.
- The channel renews only once a day; if Google ends it early (rare) edits wait for the next 02:00 UTC run. A second, more frequent renewal check would close that.

### Move Quill & Cup DNS to Cloudflare _(Needs Scoping)_
The domain is registered at Squarespace, but its DNS records are currently managed at Kajabi. Move DNS to Cloudflare so web and email traffic can be treated differently:

- **Web** (`hub.quillandcup.com` and any other site hostnames): orange cloud (proxied) for Cloudflare's CDN/WAF/DDoS layer. Vercel has its own edge network and documents caveats for proxying behind another CDN (SSL mode must be Full (strict), and Vercel's own caching/analytics see Cloudflare IPs), so confirm that trade-off before flipping the proxy on rather than assuming it's a pure win.
- **Email** (Resend's DKIM/return-path records, MX, SPF/DKIM/DMARC TXT): grey cloud (DNS only). Mail records can't be proxied.
- **Registrar** can stay at Squarespace; only the nameservers change (from Kajabi's to Cloudflare's). Transferring the registration to Cloudflare is optional and separate.

**Before switching nameservers:**
- [ ] Inventory every existing record at Kajabi's DNS (site, forwarding MX, Kajabi, Slack, Zoom verification TXT, the Resend records, etc.) and recreate them at Cloudflare *before* the cutover, so nothing drops. Also check whether Squarespace holds any DNS records of its own.
- [ ] `support@quillandcup.com` is a Squarespace email-forwarding alias (to the team Google Group). Confirm where its MX records live and whether Squarespace forwarding keeps working once nameservers point at Cloudflare; if not, replace it with Cloudflare Email Routing (see next item).
- [ ] Lower TTLs ahead of the cutover; verify the Resend domain, Supabase auth emails, and OAuth callbacks after.

### Email Routing on Separate Subdomains _(Needs Scoping)_
Auth and notification email sends from `no-reply@hub.quillandcup.com` through Resend; footers point replies to the support address. Newsletters would get their own subdomain (`news.`) later, and login email only gets `auth.` if it needs isolating. Open:
- Keep open/click tracking off on `hub.`; enable it only on `news.` if newsletters go through Resend.
- Publish a DMARC record on the root `quillandcup.com` (subdomains inherit it).
- Reply handling, if replies ever matter: the Supabase Send Email hook (real `Reply-To`) or inbound routing after the Cloudflare move. `hub` is a CNAME to Vercel and can't coexist with an MX record, so inbound mail needs a different name.
- Carry the Resend DNS records over in the Cloudflare move (DNS-only/grey cloud). Check the Resend plan's domain limit before adding subdomains.

### Clean Up set-state-in-effect Warnings
**Resolved:** the `purity`, `immutability` and `exhaustive-deps` hook rules are errors again (server pages read time through `lib/clock`, fetch helpers are `useCallback`s declared before their effects, self-rescheduling polls live inside their effect). **Still open:** `react-hooks/set-state-in-effect` is still `warn` in `eslint.config.mjs`, with ~47 sites in ~30 files (run `pnpm lint`). They fall in three groups: fetch-on-mount helpers that call `setLoading(true)` and are also reused after a save (admin `*Client.tsx` pages), reading `localStorage`/`matchMedia`/`window` after hydration (`ThemeSwitcher`, `ConsentBanner`, `InstallAppPrompt`, navigation components), and resetting state when a prop changes (`MergeMemberModal`, `CalendarWeekView`). Deferred because each fix changes when a render happens (`useSyncExternalStore`, keyed children, or a data-fetching library) and needs its own component test. Start with the hydration group using `useSyncExternalStore`, then turn the rule back to `error`. Also check `next dev` and Sentry source maps on the next Vercel preview.

### Data Access Layer: Repositories, Typed Clients, Typed Seed Data _(In Progress)_
Goals: isolate database access so other layers are tested against in-memory fakes (less DB in CI), a clear object model, compile-time column and enum checks, and typed seed profiles for tests, demos and docs. Decision: **repositories on the existing Supabase client with generated types (Option A)**, migrated area by area; Drizzle/Kysely only later, for queries PostgREST handles badly. A direct Postgres connection bypasses RLS and would need a wrapper that sets `request.jwt.claims`, the role and the sudo setting for every user-scoped query (or `audit_row_change` records `system`), so it isn't worth it for the layering goals.

**Resolved (pilot, then prickles):** `lib/data/` (generated `database.types.ts`, `Db`, `createRepos`, `getRepos`/`getServiceRepos`), `AttendanceRepository` with Supabase and in-memory implementations sharing a contract suite, every `prickle_attendance` query moved onto it (joins included: records with their prickle, type and host, and with attendee names, emails for admins only), and a guard test with an allowlist of the rest (`tests/lib/data-access-layer.test.ts`). The admin dashboard's date-range reads and the network page's full scan were unpaginated (silently capped at 1000 rows); they paginate now. Convention in `CLAUDE.md`, "Data Access Layer". `PrickleRepository` (prickles joined with their type and host; `InMemoryDataset` so in-memory joins work) is in, with the window queries behind the upcoming-prickles, schedule overview and hosting schedule, the date picker, and the hosted/calendar counts moved onto it.

**Still open:**
- [ ] **Move the remaining `prickles` call sites** (the guard test's `prickles` allowlist). **Resolved:** live room, educational prickles, the hosted-prickle stats and the upcoming list's host counts (`inProgressAt`, `ofTypeActiveBetween`, `hostedCounts`, `startingBetween` with `hostId`), then the prickle picker, the commitment slots, badges' hosting quarters and the test-notification sample prickle (`hostedStartTimes`, `nextOrMostRecent`), then the admin dashboard's host count, the community stats page and the hosting calendar (`distinctHostCount`; `startingBetween`, `types()`), then the admin test check-in DM, the calendar-feed add, the check-in modal's prickle and the check-in/check-out cron's prickle loaders (`byId`, `activeBetween`), and the first prickle writes: the unmatched-event resolve routes (`findOrCreateType`, `createCalendarPrickles`) and the member merge's host hand-over (`reassignHost`), and the prickle insights pages (`startingBetween` over a window that never passes now, `pricklesWindowEnd` in `lib/scheduled-prickle-stats.ts`). Also done: the calendar feed's four prickle reads and the schedule bootstrap (`startingBetween` now takes an optional end, for "from then on"). Also done: universal search (`PrickleRepository.search`: every word against the title, the type's name or a host the caller matched) and the admin calendar page (`startingBetween` + `attendance.forPrickles`). Also done: the admin data health (hygiene) page (`hostCoverage`, `lastCreatedAt`, `timeWindows`, `attendance.prickleIdsWithAttendance`). Also done: both prickle detail pages and `PrickleDetails` (the record now carries `description`, on the prickle and its type). Also done: the Zoom prickle lookup (`byZoomMeetings`) and the attendance processing route's reads (`calendarOverlapping`, `types()`); its writes are still the `reprocess_prickle_attendance_atomic` and `upsert_ambiguous_zoom_name` RPCs, which could become repository methods with typed payloads. Also done: the Prickles Missing Hosts page (a server page that loads through `lib/missing-hosts.ts` and passes the data to its client; `hostlessCalendarCountsByType`, `hostlessCalendarOfType`). **No direct `prickles` query is left outside `lib/data/`**; the attendance processing route's two RPC writes are now typed (`reprocessAttendanceRange`, `trackAmbiguousZoomName` in `lib/processing/attendance.ts`: payload types for the jsonb arguments, and errors thrown), but deliberately not behind a repository with an in-memory twin: `reprocess_prickle_attendance_atomic` deletes, upserts and re-inserts attendance and Pop-Up Prickles and rebuilds the range's `member_activities` in one transaction, and re-implementing that in TypeScript would drift from the SQL; the real-database reprocessability tests (`tests/api/reprocessability/`) are the check on it.
- [ ] **Type the attendance components**: `PrickleDetails`, `MemberAttendanceView`, `MemberCalendarClient` and the community-stats code take `any[]` / snake_case rows. `lib/attendance-view.ts` maps the repository's domain objects to those rows at the page boundary; give each component the domain type (`Attendee`, `AttendedPrickle`) and delete the matching adapter.
- [x] **Move the remaining `members` call sites**: done. Every read and write is on `MemberRepository`; the admin member page reads a typed `AdminMember` view (`adminView`) instead of `select("*")`, so the raw import payload no longer reaches the page or its client component. `/api/health` keeps its raw `members` query on purpose: it checks the database, not the repository.
- [ ] **Next aggregates**: whichever table is queried most outside a repository (`grep -rn 'from("' app lib components` by table). **Done since:** `push_subscriptions` (`PushSubscriptionRepository`) and `member_reminder_log` (`ReminderLogRepository`), both service role only. Each: interface, Supabase + in-memory classes, contract suite, guard-test entry. **Badges are done** (`BadgeRepository`: `badge_types`, `badge_levels`, `member_badges`; the records keep the existing snake_case `BadgeType`/`BadgeLevel` shapes that 27 files and the components use, awards are camelCase; the `sync_event_badge_awards` RPC the event routes call afterwards is not wrapped). **Notifications are done** for member preferences and the in-app inbox (`NotificationRepository`: `in_app_notifications` and `notification_preferences`); `push_subscriptions` (service role only; holds push credentials) and `member_reminder_log` (backoff and dedup) are still direct, one or two files each.
- [ ] **Where the data layer stands (2026-10-28)**. **Behind repositories, guard entries empty:** `prickle_attendance`, `prickles` (and its types, see below), `members`, notifications, badges, push subscriptions, the reminder log, name and email aliases, writing (`WritingRepository`: projects, goals, progress entries, starting balances), events (`EventRepository`: events, attendees, photos), `prickle_schedules`, `member_activities`, `member_directory`, `user_profiles` (`isAdmin` fails closed), `bronze.calendar_events` and `bronze.slack_users` (the first repositories over the `bronze` schema). **Still direct**, by queries outside `lib/data/`: the chat tables (~53, plan below); then `prickle_types` (17: `PrickleRepository` covers it, but the guard test has no `prickle_types` entry, so these slipped through; add the entry and move them), `unmatched_calendar_events` (14), `member_program_enrollments` (14), `zoom_attendees` (13), `slack_messages` (12, service role only), `programs` (11), `kajabi_customers` (11) and the other Kajabi/Stripe Bronze tables, `courses`/`videos`/`lesson_progress`, `member_books`, `member_status_overrides`, `member_hiatus_history`, `prickle_commitments`, `prickle_checkins`, the calendar-feed tables, `calendar_sync_state`. Each is a few files: take them by aggregate (programs and enrollments and cohorts; the Kajabi/Stripe Bronze tables; courses; status and hiatus) the way the earlier ones went. Patterns that worked: a skeleton PR that wires the repository and registers the table with every file still querying it, then agents in separate worktrees each owning disjoint files and appending a labelled section, rebasing one at a time (conflicts are only in `writing.ts`-style shared files, `in-memory.ts`, `repos.ts`, the contract and the guard test); read-only callers that ignored errors keep doing so with `.catch(() => null)`; authorization reads fail closed.
- [ ] **Course Silver and Local tables behind a repository.** **Resolved (2026-10-31):** the Silver curriculum (`courses`, `course_modules`, `course_lessons`, `course_lesson_files`) and `videos` are on `CourseRepository` (`lib/data/courses.ts`), and the Local and derived tables `lesson_progress`, `course_access`, `course_access_grants` and `video_watch_segments` on `CourseProgressRepository` (`lib/data/course-progress.ts`), each with a twin and a contract suite run against the twin and the database. Every query in `lib/courses/*`, the course admin actions, the watch route, the Mux webhook and the course routes goes through them; the guard test lists no files for these tables, and the string-table `fetchAll` helper (`lib/courses/db.ts`) is deleted. The Kajabi course Bronze tables were already on `KajabiCourseRepository`. **Still open:** the device-retention job (`lib/retention/network-details.ts`) reads and clears `video_watch_segments` through a table-name variable the guard cannot see, so it still queries the table directly until retention gets its own repository. **Also resolved:** the `upsertInBatches(supabase, "slack_users", ...)` bypass in `app/api/import/slack-api/route.ts` now goes through `SlackUserRepository.upsert` (chunked by `upsertInChunks`), and the guard also reads a table name passed to `upsertInBatches`. **Still open:** the import's other Bronze tables (`slack_channels`, `slack_messages`, `slack_reactions`) still use that helper until they get repositories.
- [ ] **The chat tables (~53 queries in 21 files)**: `chat_channels` (8), `chat_channel_members` (11), `chat_messages` (20), `chat_message_contents` (5), `chat_reactions` (2), `chat_slack_authors` (5), `chat_gap_fills` (2). They are bigger than the earlier aggregates because of rules that are easy to break in a move: RLS gates a message's text per channel (`chat_message_contents` is its own table so RLS can hide it; reads run as the caller, writes as the service role), Slack bridging has its own state (`bridge_mode`, `bridge_disabled`, `bridge_status`), several flows go through functions (`chat_post_message`, `search_chat_messages`, `project_slack_chat_channels`), and read state is pulled from Slack (`lib/chat/slack-read.ts`). Plan: **(1)** a skeleton PR (`ChatRepository` interface in `lib/data/chat.ts`, Supabase and in-memory classes, dataset arrays, `createRepos`, and the seven tables in the guard test with every file that queries them; one real method to prove the shape, e.g. the channel list `lib/chat/load.ts` builds). **(2)** Four agents, one per slice, each adding a labelled section: *channels and membership* (`chat_channels`, `chat_channel_members`: `lib/chat/load.ts` channel/member reads, `membership-actions.ts`, `chat/actions.ts`, `chat/[id]/page.tsx`, `chat/[id]/members/page.tsx`, the channel parts of `slack-read.ts`/`gap-fill.ts`); *message reads* (`chat_messages`, `chat_reactions` reads: `load.ts`, `search.ts`, the `search_chat_messages` call as a typed wrapper, `components/chat/ChatLive.tsx` (a client component: its reads can take the browser client, the realtime subscription itself stays out of the repository)); *message writes* (`slack-post.ts`, `slack-edit.ts`, `slack-react.ts`, `chat/actions.ts` writes, `api/webhooks/slack/route.ts`, `chat_post_message` as a typed wrapper); *content, files, authors and gap fills* (`chat_message_contents`: the two file routes, `file-cleanup.ts`, `slack-upload.ts`; `chat_slack_authors`: `names.ts`, `slack-membership.ts`; `chat_gap_fills`: `gap-fill.ts` and its admin page). **(3)** Rules for all four: the repository takes whichever client the caller has (the privilege is the client's), so a content read stays service-role where it is today; no behaviour change, including which reads swallow errors; the RLS behaviour is covered by the existing pgTAP tests, the repository contract runs as the service role and checks the data rules; external calls (Slack API, `pullReadFromSlack`) stay outside the repository. Merge order: skeleton, then channels (the others join through channel ids), then the rest in any order. Expect the message-reads and writes slices to share helper methods; give them one owner for `chat_messages` row shapes (a `ChatMessageRow` in the skeleton) to avoid two near-duplicate types.
- [ ] **Typed seed profiles**: **First profile done.** `lib/data/seed-profile.ts` defines `SeedProfile` (people, a weekly rhythm, badges, notifications) and `buildDataset(profile, now, { timeZone })`, which turns it into an `InMemoryDataset` relative to `now` (members, prickle types, prickles with hosts, attendance for the ones that have ended, badges, notifications; deterministic). The demo community is `lib/data/profiles/community.ts`, and `demo/personas.ts` and `demo/seed.ts` now read the cast, bios and rhythm from it, so the demo database and the in-memory community have one source. **Still open:** the demo seeder still writes members, calendar events and Zoom rows to the database itself (it does not load the profile's badges and notifications); a second profile for a state the community isn't in (a brand-new member, an at-risk lapse) would show whether `SeedProfile` needs more fields; a way to load a profile into the *local* database for development; and member-facing help articles that cite the profile instead of repeating names.
- [ ] **Direct SQL path (Drizzle/Kysely)**: revisit when a repository needs joins, CTEs or window functions that an RPC makes awkward. Try it on one read-only service-role route first, with `prepare: false` behind the pooler.
- [ ] **Convert big `supabase`-taking functions** (`getMemberBadges`, `getPrickleScheduleOverview`) to take a `Repos`, so their tests stop faking PostgREST.

### Faster `main` CI: Serialize Only the Deploy Jobs _(Needs Scheduling)_
Runs of `ci.yml` on `main` queue one behind another: `concurrency` at the top of the workflow is `ci-<workflow>-<ref>` with `cancel-in-progress` false on `main`, so a merge waits for the whole previous run (tests included, ~10-15 min) before its own tests start. Two merges in quick succession (for example a fix right after a broken merge) can leave the second waiting 10+ minutes. Deferred because the group is what keeps migrations, the deploy and the Slack manifest token rotation from overlapping, and a mistake in this change breaks production deploys.

- [ ] Take the run-level `concurrency` off `main` (keep `cancel-in-progress` for pull requests), so tests, build and coverage for different commits run in parallel.
- [ ] Put a job-level `concurrency: { group: prod-deploy, cancel-in-progress: false }` on `push-migrations`, `deploy`, `push-slack-manifest` and the Vercel config push, so only one touches production at a time and none is cancelled mid-flight. GitHub keeps one pending job per group and replaces older pending ones, which is fine: the newest commit contains the older ones' migrations and code.
- [ ] Guard against out-of-order deploys: with parallel tests an older commit can finish after a newer one. Each production job first checks that `$GITHUB_SHA` is still the tip of `main` (`git fetch origin main`, then compare with `git rev-parse origin/main`, or `git merge-base --is-ancestor`) and skips otherwise.
- Check first: the Free plan caps runners at 20 concurrent jobs per account, so parallel runs compete with PR runs and CodeQL for slots and the gain shrinks when busy. `Check migration numbering` stays outside the deploy group, unchanged. Roll out in its own PR and watch the next two `main` runs (`ship-via-pr.md` step 7). Related and cheaper: run CodeQL only on `main` plus a weekly schedule instead of every PR and push.


### Trim CodeQL Runs _(Needs Scheduling)_
CodeQL is on GitHub's default setup (`gh api repos/quillandcup/hub/code-scanning/default-setup`: languages `actions` and `javascript-typescript`, weekly schedule), which scans every pull request and every push to `main`. Those runs share the Free plan's 20-concurrent-job pool with CI, so during a burst of merges they compete with the required checks for runners (each run is short, about 1 to 10 minutes, so this is a small share next to CI). Deferred because it trades away per-PR scanning, which is a security decision, and because the default setup has no trigger options: narrowing them means replacing it with an advanced setup.

- [ ] Decide whether per-PR scans are worth the runner slots. Alternatives: scan only `main` plus the weekly schedule, or keep PR scans only for paths that change code (`app/`, `lib/`, `components/`, `.github/workflows/`) and skip docs and migrations-only PRs.
- [ ] To change triggers: disable the default setup (Settings -> Advanced Security -> Code scanning), add `.github/workflows/codeql.yml` (GitHub's template, `on: push` to `main`, optional `pull_request` with `paths`, and `schedule`), and keep both languages. Add a repo-config note if a ruleset ever requires the check. The `Analyze (...)` jobs aren't in the required checks today (`github-repo-config.yml`), so removing them from PRs doesn't block merging.
- Related: `Faster main CI: Serialize Only the Deploy Jobs` above. Do that one first; it is the larger part of the queueing.

### Version skew: old tabs call server actions that no longer exist _(Needs Scheduling)_
- **What is wrong:** A browser tab opened before a deploy keeps the old build's JavaScript and server action ids, and posts them to the new deployment, which answers `UnrecognizedActionError: Server Action "..." was not found on the server` (Sentry issues HUB-A and HUB-6, about 14 events over three weeks, roughly one per deploy, no affected users reported). Deploys are atomic, so this is not downtime; it is version skew.
- **Why Skew Protection isn't saving us:** The Vercel project has it on (`skewProtectionMaxAge` 43200, read with the Vercel API, 2026-10-23), but the live site doesn't use it: the static assets on `/login` carry no `?dpl=` and the HTML has no `data-dpl-id`. Next only attaches the deployment id (assets, `x-deployment-id` header, `data-dpl-id`, reload on mismatch) when `deploymentId` or `NEXT_DEPLOYMENT_ID` is set at build time (`node_modules/next/dist/docs/.../next-config-js/deploymentId.md`), and neither is set. CI builds before the deployment exists (`vercel build --prod`, then `vercel deploy --prebuilt --prod`, `.github/workflows/ci.yml`), so the build may not know its own deployment id; that part is unconfirmed.
- **Why deferred:** The fix needs a decision: a per-deploy `deploymentId` (even the git SHA) makes Next hard-reload a stale tab on mismatch, but routing old tabs to their original deployment is Vercel's job and may need the deployment id from Vercel at build time, which a `--prebuilt` flow might not have. Impact so far is small.
- **Where to start:** Find out how Vercel handles Skew Protection for `vercel build` + `deploy --prebuilt` (does `vercel build` set `VERCEL_DEPLOYMENT_ID`?). Then try `deploymentId` in `next.config.ts` and check that `/login` assets carry `?dpl=`. Keep HUB-A and HUB-6 open in Sentry until fixed; they are the evidence, so don't mute them.
- **Resolved (2026-10-31):** the deploy workflow's `vercel build --prod` now runs with `NEXT_DEPLOYMENT_ID` set to the commit being built, so Next attaches the id and hard-reloads a stale tab on mismatch.
- **Still open:** confirm after the first deploy that `/login` assets carry `?dpl=` and the HTML has `data-dpl-id`. This does not route an old tab's action call to its original deployment (Vercel's own `dpl_` ids aren't known to a prebuilt build); if stale tabs still hit `UnrecognizedActionError` on actions (not navigations), look at a remote Vercel build. Then resolve HUB-A and HUB-6 in Sentry.

---

### Adopt Cache Components (`cacheComponents`) _(Needs Scoping, not urgent)_
Next 16 has a new caching model behind `cacheComponents` in `next.config.ts` (the `"use cache"` directive, `cacheTag`/`cacheLife`/`updateTag`, Partial Prerendering and Partial Prefetching); the docs say it becomes the default in the next major release. We are not on it. Chat's cross-request lookup cache (`lib/chat/lookup-cache.ts`) uses the older `unstable_cache`, which still works. Looked at while speeding up chat switching, and decided not to adopt it for that: (1) every one of the ~112 pages (and the layouts) reads the signed-in user from cookies, and under Cache Components request-time data outside a `<Suspense>` boundary fails the build, so most routes need restructuring, not a flag flip; (2) the 8 route segment config exports (`dynamic`, `revalidate`, `runtime`, find them with `grep -rnE "export const (dynamic|revalidate|runtime|fetchCache)" app`) must be migrated and `runtime` is unsupported; (3) the `unstable_cache` calls move to `"use cache"` (small); (4) the gain is a static shell plus partial prefetching, but our pages are per-user and database-bound (production chat renders spent 100-500ms per query, not rendering a shell), so it would not shrink the measured cost. Nobody has tried a build with it, so the size of (1) is an estimate. Start from the docs' "Migrating to Cache Components" guide (`node_modules/next/dist/docs/01-app/02-guides/migrating-to-cache-components.md`) and a throwaway branch with the flag on, counting build errors, before scheduling it; revisit when the next Next major lands.

### Media library follow-ups

The media library foundation is in (`docs/MEDIA_LIBRARY.md`): table, bucket, repository, upload and serving routes. Left for the PRs that add its first users:

- **Analytics**: the picker and `/admin/media` record `media_picker_opened`, `media_picked`, `media_cleared`, `media_uploaded`, `media_edited`, `media_deleted` and `media_downloaded`. Each new surface (book covers) extends the `surface` list in `lib/analytics/events.ts` and `lib/media/surfaces.ts`.
- **`/admin/media` is staff only and shows the shared library.** Usage lists events, books and (unnamed) projects; each feature that gets an `*_asset_id` column adds itself to `MediaRepository.usages`.
- **Members' image control is built; staff's picker is still staff-only.** **Resolved:** a member picks and uploads their own book cover through `MediaPicker` with `own` (`GET`/`POST /api/bookshelf/cover`, the editor through `/api/bookshelf/cover/<id>`). **Still open:** `GET`/`POST /api/media` and the staff library stay staff-only, which is right for the shared library; a member image for anything but a book cover needs its own `own`-style routes (see "Member uploads other than book covers").
- **Orphaned objects** (a file with no `media_assets` row, a `renditions/<id>/` folder for an id that no longer exists) are not swept: the nightly sweep (`lib/media/sweep.ts`) goes from rows to files, not the other way. They can only come from a failed insert after an upload or a hard delete in the database; list the `originals/` and `renditions/` folders against the table if the bucket ever grows unexplained.
- **Deleted images can't be restored from the UI.** Within the 30 days before the sweep removes the files, staff can clear `deleted_at` in the database; `/admin/media` has no "deleted" view or undo.
- **Member uploads other than book covers.** `POST /api/media` and the picker are staff-only; only `POST /api/bookshelf/cover` takes a member's upload, as a multipart request up to 4 MB (a request body limit). Bigger covers would need the signed-URL path (`/api/media/uploads`) for members.
- **Older book covers**: **Resolved:** `pnpm covers:adopt` moved them into the library; in production every live book and project cover is a library image (checked read-only, 2026-10-30), the `book-covers` and `course-images` buckets are deleted, and the forms no longer show a cover that is only a link. A fresh database still creates both buckets from their migrations (SQL can't delete a bucket; no policy opens them).
- **Making the Bookshelf public.** The covers are ready: set `bookshelfPublic: true` in `app.config.ts` and a book's cover is served at its shelf size to visitors who aren't signed in (`lib/media/public-covers.ts`; the Amazon version, a project's cover and other images stay behind sign-in). The page itself is not: `/bookshelf` is a member page, so it still needs a signed-out route, a decision about what it shows of each author, and the proxy to let it through.
- **Staff can't see a member's covers** in `/admin/media` (it lists the shared library); a cover shows up there only as a usage when a shared image is used by a book.
- **SVG** is refused. Worth accepting for logos on the marketing site (sanitized, served with a sandboxing CSP); see `docs/MEDIA_LIBRARY.md`, "Upload safety".
- **Videos and files in the catalog.** `media_assets.kind` allows `video` and `file` but only images are created. The course builder's migration relaxes the image-only NOT NULLs per kind and links `videos` (see "One catalog" in `docs/MEDIA_LIBRARY.md`).
- **Paperback and hardcover covers** need a full wrap (back, spine, front) with a spine width from page count and paper type: a cover template, not a crop. Out of scope until asked.
- **A free-form crop rectangle.** Crops are a preset size around a focal point (`Adjust crop` sets the point and, for covers, how a picture of another shape fits); there is no draw-a-rectangle crop. Deferred because one focal point fixes every shape at once (event card, hero, shelf, Amazon) and a rectangle fixes one. If someone needs exact framing, add an optional per-use crop stored as fractions (x, y, w, h) that overrides the focal point; the original stays untouched. Start in `lib/media/render.ts` (`settingsFor`) and `components/media/MediaEditor.tsx`.
- **The "Add event" form can't pick from the gallery.** The Event photos tab needs an existing event with imported photos, and a new event has none. Offering it there would mean creating the event first (or importing photos before saving), a different flow; the admin event page has it (`MediaPicker`'s `eventPhotos`).

### Intermittent failures in the full unit suite _(Needs Scheduling)_

Seen 2026-10-29 on clean `origin/main` (2 of 4 full `pnpm test:unit` runs on a laptop with the local Supabase stack running) and on feature branches; each file passes alone, so it shows only under full-suite load. Two causes so far:

- **`tests/components/pages/admin-calendar-data.test.tsx`** raises an unhandled `TypeError: The "event" argument must be an instance of Event` from undici's WebSocket (`fireEvent` in `undici/lib/web/websocket/util.js`): something it renders opens a real Supabase Realtime WebSocket (the prickles realtime change, `20270224300000_prickles_realtime.sql`) under jsdom, where jsdom's `Event` and Node's differ. The run fails even though every test passes. Start by mocking the realtime client in that test (or in the component's data hook) so a unit test never opens a socket, which also makes it independent of whether a local stack is up.
- **`tests/lib/commitments.test.ts`** and **`tests/lib/outcome-wiring.test.ts` (`saveCheckin reports checkin_saved`)** each failed once in a full run and passed alone and on re-run. Not diagnosed; check for real waits or shared state (`CLAUDE.md`: tests use the fake clock, no real waits).

CI runs on a machine without the stack and hasn't shown this, so it is cheap to fix now and expensive to find once it starts failing there.

### Alerts that don't depend on the app being healthy

Every alert today (`lib/operations-alerts.ts`: failed DMs, `section_failed`, `client_crash`, cron problems) is sent by the app itself, through its own database (`rate_limit_hit`), Slack token and Resend. When the database is timing out or the deploy is broken, the alerting path is the thing that is broken, and a crash the app can't report stays silent. Sentry would be the independent path but its Slack integration needs the Team plan (about $26/month), which is more than this is worth. Deferred because it needs a choice of mechanism. Options to evaluate, none verified yet: a Sentry internal integration with a webhook on the alert rule action pointed at a Slack incoming webhook (Sentry's docs say rules can send to webhooks on the free plan; confirm, and that a payload Slack accepts needs a small formatter); Sentry's own email alerts on new issues (included in every plan, and independent of the app); Checkly, which already watches production (`__checks__/`), alerting `ALERTS_EMAIL` or Slack from outside the app on a failing check; a free serverless function as the Sentry-to-Slack formatter. **Resolved:** Sentry's email issue alert (free on the Developer plan) was already set up (the default "high priority issues" rule fires on new production issues), but it mailed the account's primary address, which was an old work address; with the primary changed to the organization's own address, its test notification arrived. **Still open:** decide whether Slack also needs an independent path (the options above), and keep the primary address in mind when the Sentry account changes hands. Then update `docs/SLACK_OPERATIONS_ALERTS.md`, which says the app posts its own alerts.

### Page sections that fail alone, and tracing beyond the member page

The admin member page loads about fifteen queries in one server render, so a single statement timeout (57014, seen once in production) blanks the whole page. The PR adding `lib/query-trace.ts` names the failing query in Sentry, logs sections over 2s and adds `error.tsx` pages with a digest, but the page still fails as a whole. Deferred because it needs a decision per panel about what an empty state should say. Start in `app/(admin)/admin/members/[id]/MemberDetailPage.tsx`: wrap the non-essential panels (Slack feed, activity feed, membership history) so an error shows "couldn't load" for that panel only. Then use `traced()` on the other heavy pages (`/admin/activity`, the member dashboard) and watch the `[slow section]` log lines for what to index.

### Client bundle check that doesn't depend on a list of packages

`tests/lib/client-server-boundary.test.ts` walks our own imports and flags a client file that reaches a "server-only" one, but what counts as server-only is a hand-written regex of package names (`SERVER_ONLY_PACKAGES` in `tests/helpers/client-server-boundary.ts`). A server SDK missing from it passes CI and breaks pages in the browser: #615 pulled `@slack/web-api` (and through it `node:fs`) into every page with the record-history button, and CI was green (fixed in #626; the list was extended afterwards). Deferred because the fix is a different kind of check, not another entry. Start by scanning the built client output instead: after `next build` (the `Test (db) & build` job already builds), fail if any file under `.next/static/chunks` references `node:fs`, `node:child_process`, `node:net` or other Node-only modules, which catches any package, direct or transitive, with no list to maintain. Keep the import walker for its readable chain ("A -> B -> C") and for the server-imports-client rule.

### Production database memory, and the jump from Small to Medium

Statement timeouts (57014) kept hitting unrelated queries in production: the admin member page's `count_activity_feed` (Sentry HUB-G), the calendar import and its reprocess, and the Kajabi reads. It was not a bad query. For the member in HUB-G the three branches of the count use their indexes and read from cache (about 1s in total when idle, against the 8s limit), and the function was already reworked for planning in `20270306100000`. The Supabase dashboard (Reports → Database, one hour on the day it was looked at) showed memory, not CPU or disk: total RAM 408 MB with 843 MB in swap (206% of RAM) and memory commitment marked SEVERE at 1.76 GB against a 1.4 GB capacity, while CPU was about 92% idle, disk IOPS about 12 of 3,000, connections 20 of 60 (PostgREST 11), and the database 0.37 GB. `shared_buffers` is 224 MB and `max_connections` is 60, the Nano profile. Anything that needs memory (a window sort, a big scan) waits on swap, and a heavy job overlapping an admin page tips it over the 8s statement timeout.

**Done:** compute moved from Nano ($9.68/month) to Small (2 GB, about $14.83/month) by hand in the dashboard (Micro, 1 GB, is a free upgrade at the same price as Nano, but more load is expected once there are more members). Read-only production checks six minutes after the restart: `shared_buffers` 224 MB -> 512 MB, `max_connections` 60 -> 90, and the same member-page queries took 1-5 ms (`member_activities` branch, was 400 ms) and 13-24 ms (`access_events` sort, was 630 ms). That was a freshly restarted instance under light load, so it proves the plans, not the headroom. **Still open:**
- Read the dashboard's memory chart after a day of normal use: swap should be well below RAM and commitment out of SEVERE (the database CLI can't show swap). Swap should fall well below RAM and commitment leave SEVERE; if not, the load is heavier than it looks.
- **The next step up is a cliff.** Medium (4 GB) is about $59.18/month, four times Small, so memory use is worth keeping down before more members arrive. Start with what reads the most: the Kajabi bronze tables are read in full 20k+ times with `OFFSET` paging (`pg_stat_statements`: about 330 ms mean per page, on `bronze.kajabi_contacts` and `bronze.kajabi_purchases`; the stats have run since June, so means are blended), PostgREST's connection pool size, and imports and reprocessing that overlap each other and admin use. Compare `pg_stat_statements` (read-only, `supabase db query --linked --project-ref ...`) before and after to see what changed.
- **Compute size is not config as code.** `supabase/config.toml` has no key for it. The Management API can set it (`PATCH /v1/projects/{ref}/billing/addons` with `addon_type: "compute_instance"` and a variant such as `ci_small`, needing the `infra_add_ons_write` permission), like the "Enable leaked password protection" step in CI. A change restarts the database, so a step on every push would have to read the current size and only write when it differs; unverified whether re-applying the same variant is a no-op. A cheaper start is a read-only drift check that fails when the live size differs from a value in the repo. Not built because the size changes rarely; build it if it drifts or when a second environment appears.

## Security & Access Control


### Removal on request for records with a required member id _(Approach decided 2026-10-31; not built)_

`/privacy` promises that when a member asks us to remove something we "either delete it or take your name off it". Nothing implements that yet: removal on request is a manual job for staff. For usage events the design is a scrub that nulls the identity columns and keeps the row (`docs/EVENT_LOG.md`, "What a scrub does"). Records a member owns by a required id (writing goals, progress entries, books, awards, check-ins, commitments, notes) have `member_id NOT NULL` and can't be scrubbed that way.

**Decided: re-point them at a placeholder "former member" row.** That keeps the record's shape and loses the person. The catch: the content itself can identify someone (a book title, a note in their own words), so a table whose content identifies gets its rows deleted instead; decide that per table when building, next to its retention in the event catalog.

**Order of operations:** a scrub or re-point is irreversible and untraceable (afterwards we can't find a person's rows to delete them later or to answer an access request), so a request for true deletion must happen before any anonymising.

**Still to build:** one `remove_member_data(member_id, mode)` routine so staff don't hand-write SQL, with the per-table choice (re-point or delete) in the catalog, and a pgTAP test that nothing identifying remains. Related: phase 0 of `docs/EVENT_LOG.md` (done) and the retention schedule.

### Scrub private data from the public repo and its history _(Needs Scheduling)_

The repo is public. A full-history scan (2026-10-02, every blob in every commit) found private
values in docs, tests and code. Don't copy any of them into this file or a PR -- refer to the
location instead.

**Missed by that scan (example, found 2026-10-21):** a real member's name in this file's Kajabi Payments entry, added in commit `c8f3cf7b` (2026-09-04) and removed from the current file in the PR that reviewed this list, but still in history. Re-run the audit with names in mind (docs, TODO entries, comments, test fixtures), not just emails and ids, and add that commit to the rewrite list.

1. **Remove from the current files** (normal PR), replacing each with a pointer to where the
   value lives (`.env.shared` / `.env.prod`, see `docs/ENV_MANAGEMENT.md`):
   - Staff email (the Zoom login line) -- `docs/SECRET_ROTATION.md`
   - Real Google Calendar ID -- `docs/CALENDAR_SETUP.md`, `docs/CALENDAR_SYNC.md`, `docs/INTEGRATION_LINKS.md`
   - Google service-account emails -- `docs/INTEGRATION_LINKS.md`, `docs/SECRET_ROTATION.md`
   - Kajabi client ID -- `docs/INTEGRATION_LINKS.md`
   - Slack workspace/app IDs -- `docs/INTEGRATION_LINKS.md`, `docs/SECRET_ROTATION.md`
   - Org addresses (team, no-reply) -- `docs/TODO.md`, `docs/MEMBER_MATCHING.md`
   - **Member emails (PII)** -- `tests/components/AmbiguousNamesResolver.test.tsx`; swap for
     `@example.com` fixtures like the rest of the tests
2. **Rewrite history** to drop the values above plus ones only in older commits: the same
   calendar ID in the deleted `.env.local.example`, member emails in earlier versions of
   `tests/lib/member-matching.test.ts`, `tests/lib/member-suggestions.test.ts`,
   `app/api/analyze/subscription-reconciliation/route.ts` and `scripts/add-email-alias.ts`, a
   personal alerts address (`__checks__/alert-channels.ts`, `app.config.*`), and the
   engineering-alerts addresses (PR #44's commit message and `env-vars.config.ts`).
   - Tool: `git filter-repo --replace-text` with a local (never committed) replacements file;
     regenerate the list by re-running the scan, since new commits may add more.
   - It's a force-push of `main`: coordinate first -- merge or close open PRs, and have every
     session/worktree re-clone or hard-reset afterwards (old branches would reintroduce it).
   - GitHub keeps the old commits reachable through PR refs (`refs/pull/*`) and caches until
     GitHub Support purges them -- request that after the push. Forks and existing clones keep
     the old history regardless.
   - Not found anywhere in history: real API tokens or keys. The Supabase key and Slack-token
     look-alikes are the public local-dev demo key and placeholders.

### Repo Security Settings and Scans _(Needs Scheduling)_
Found 2026-10-22 by comparing the live repo's `security_and_analysis` (read with
`gh api repos/quillandcup/hub`) against what GitHub offers for public repos. Secret scanning and push
protection are already on; these four are not. All are free on a public repo and none changes code,
so none was urgent. Deferred to batch them.

- [ ] **Secret scanning: non-provider patterns.** Off today. Adds private keys, connection strings
      and generic high-entropy keys to what push protection and alerts catch (provider-pattern
      scanning only covers known token formats). Settings → Advanced Security → "Scan for
      non-provider patterns". Expect some false positives on test fixtures and the local-dev demo
      Supabase key; dismiss those with a reason ("used in tests"), or add narrow `paths-ignore`
      entries in `.github/secret_scanning.yml` (it also skips push protection for those paths, so keep it specific).
- [ ] **Secret scanning: validity checks.** Off today. GitHub tests a detected credential against
      the provider and marks the alert `active`, `inactive` or `unknown`, which tells us whether a
      leak needs rotating now (`docs/SECRET_ROTATION.md`) or is already dead. Same settings page.
- [ ] **Dependabot security updates.** Disabled today, though `.github/dependabot.yml` already
      runs weekly version updates (npm and github-actions) and `auto-merge.yml` merges the
      patch/minor ones. Security updates are a separate setting: they open a PR as soon as an
      advisory affects a dependency, instead of waiting for the weekly run, and can raise a
      version the weekly grouping wouldn't. Enable it, then check the open alerts alongside the
      `npm audit` findings in "Migrate to Tailwind CSS 4". Majors still need a human; confirm
      `auto-merge.yml` doesn't merge a security major.
- [ ] **Run the built-in `/security-review` skill on a schedule?** Undecided; the question is
      whether it finds enough to be worth the tokens. Try it once on the whole repo and on a recent
      auth- or RLS-touching PR, and record what it found that `pnpm test:unit`, the pgTAP suite
      and `/code-review` didn't. If it earns its keep, run it before merging changes to auth, RLS,
      `proxy.ts`, webhooks or anything that exposes ids, rather than on a calendar (a cron
      agent via the `schedule` skill is the alternative). If it only repeats what the checks above
      already enforce (`requireAdminPage` test, Tier 2 id rule, Slack-content grants), drop this
      item.

Where to start: check whether the `settings:` block of `github-repo-config.yml` (applied by
`scripts/github-config.ts`) can carry these. If it can't, toggle them in the GitHub UI and note
here that they live outside the config-as-code file.

### User Invitations
- **In-app invite management**
  - Admin page to send invites with pre-set roles
  - Email templates for invitations
  - Track invite status and expiration

### Row Level Security (RLS)
- **Role-based restrictions**
  - Add assistant/member roles when we have non-admin users
  - Update policies to restrict based on role
  - Test thoroughly before granting access to non-admins

### Supabase Security Advisories (Skipped)
Two low-severity advisories from `supabase db advisors --linked --type security` were left unresolved after the 2026-08 RLS/search_path hardening pass (see `supabase/migrations/20260720034138_enable_rls_on_exposed_tables.sql` and `20260807023835_harden_search_path_and_definer_grants.sql`):

- **`anon_security_definer_function_executable` / `authenticated_security_definer_function_executable` on `is_admin()` and `create_user_profile()`** — both are `SECURITY DEFINER` and still grant `EXECUTE` to `anon`/`authenticated`. Not revoked because:
  - `create_user_profile()` is the `on_auth_user_created` trigger function that provisions a `user_profiles` row on signup — revoking risks breaking signup.
  - `is_admin()` is called inside the `user_profiles` RLS policies (`USING (is_admin())`) for role `{public}` — revoking `authenticated`/`anon` EXECUTE would likely break those policies for logged-in users, not just tighten anon access.
  - Real-world risk is low: `is_admin()` just returns a boolean based on `auth.uid()` (returns `false` for anon since `auth.uid()` is null), and `create_user_profile()` is a trigger function that errors if invoked directly outside trigger context.
  - **If revisited:** switch `is_admin()` to `SECURITY INVOKER` (it only reads `user_profiles`, which already has its own RLS) instead of touching grants, and/or restrict `create_user_profile()`'s grant to just the role Postgres uses to fire the trigger.

### Role-Based Access Control (RBAC)
Define user roles and permissions:

1. **Member/Customer** (future)
   - View own profile and attendance history
   - Cannot access other members' data
   - Cannot access admin tools

2. **Admin** (current default)
   - Full access to all features
   - Import/process data
   - View all members and prickles
   - Edit members, prickles, aliases

3. **Assistant** (future)
   - Read-only access to member data for support
   - Can view attendance and engagement metrics
   - Cannot edit or delete
   - Cannot access import/process tools

4. **More granular roles** (future consideration)
   - Content Manager - manage prickles/calendar only
   - Analytics Viewer - read-only dashboards
   - Onboarding Specialist - member CRUD only

**Implementation:**
- Add `role` column to user profiles table
- Create RLS policies per role
- Update UI to show/hide features based on role
- Add role management interface for admins

---

## Login & Access History

### Session Replay (PostHog bolt-on)
Per-user login/access history (`access_events` table + `get_access_sessions()`, surfaced via a "History" view on `/admin/users`) tracks when a user came back and what pages they visited, sourced directly from Supabase — see `supabase/migrations/20260827140000_create_access_events.sql`. That covers "when did they come back" and "what pages did they view," but not literal visual playback of what happened on screen.

**Idea:** Add PostHog's free tier (1M events/mo, session replay included) as a bolt-on for that specific need — `posthog.identify(userId)` client-side, tied to the same Supabase auth id. Not a replacement for the custom table: PostHog's dashboard is a separate view, not integrated into `/admin/users`. Self-hosting PostHog is ruled out.

**Why deferred:** The custom table already answers the primary ask (login history + page trail inside the existing admin UI) with no new infrastructure or third-party script. Session replay is a nice-to-have for UX debugging, not a blocker.

---

## Notifications

### Channels, Notifications & Messaging _(v1 live: Slack, in-app (flagged), browser push (flagged), email + per-kind notification settings; more channels next)_
One system for everything the Hub sends members, instead of each feature hand-rolling a Slack DM. Three layers (this replaces the CRM section's "Messaging Abstraction Layer" item):

- **Channels** (`lib/channels/`): the delivery systems (Slack, in-app, browser push and email today; SMS, WhatsApp next). Each adapter resolves a member to an address and sends an `OutboundMessage` (`text`, `url`, per-channel rich bodies like `slackBlocks`, `footerLinks`, and `timeSensitiveUntil`: how long it's worth interrupting for, which each channel interprets, e.g. in-app banner vs bell only). Shared by both layers below; nothing above it talks to a provider directly.
- **Notifications** (`lib/notifications/`): the app reaching out, governed by the member's per-kind channel choices. Mostly one-way, but some ask for an answer (check-in/check-out selects); the reply comes back over the same channel's inbound webhook.
- **Messaging** (planned): two-way conversations, e.g. in-app chat bridged to Slack (`docs/SLACK_BRIDGED_CHAT.md`), and later SMS/WhatsApp threads. Uses the same channel adapters, plus the inbound half they don't have yet. Members won't move off Slack for chat without notifications for new messages, mentions and DMs, so chat events become notification kinds too.

**Built (v1):**
- `lib/channels/`: `CHANNELS` catalog (client-safe), `ChannelAdapter`, `CHANNEL_ADAPTERS`. Slack adapter (`slack.ts`) DMs via `sendSlackDM` and renders `footerLinks` into the message's context footer.
- In-app adapter (`in-app.ts`, "In the Hub"): writes `in_app_notifications` (Local layer, migration `20261004000000`), kept for good. Shown by `components/InAppNotifications.tsx` (polls every minute while the tab is visible): a bell in the member header (unread count across all, the latest 10, "Mark all as read", a link to the inbox) and a banner under the header for unread ones still within `timeSensitiveUntil`. The inbox (`/notifications`) is a server-mode data table: All/Unread tabs with counts, a type filter, sort by type or received, the standard pager. Read when opened, its banner dismissed, "Mark all as read", or when the feature calls `resolveInAppNotifications(kind, ref)` (check-ins once answered, wherever). Behind the `in_app_notifications` feature flag: unflagged members can't be reached on it and don't see its switch. Default on for both check-in kinds: a check-in is time-sensitive until the prickle starts, a check-out for 3 hours after it ends.
- Web Push adapter (`web-push.ts`, "Browser"): sends with the `web-push` package and VAPID keys (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`; generate once with `npx web-push generate-vapid-keys`, then `pnpm env:sync`) to every live row of `push_subscriptions` (Local layer, migration `20261014000000`: one per browser a member turned it on for; service role only since it holds push credentials; soft-deleted when the member turns it off or the push service answers 404/410). The service worker `public/sw.js` (excluded from the proxy matcher so it loads without a session) shows the notification and opens the Hub path on click. A time-sensitive message goes with `urgency: high` and a TTL ending at `timeSensitiveUntil`, so a missed check-in isn't delivered after the prickle. The worker never sets `requireInteraction` on a push: in Chrome a push-delivered persistent alert is shown but its click never reaches the worker (found with the Admin → Test Notifications click diagnostics; the same alert shown from the page works). Behind the `browser_notifications` flag, on by default for both kinds, but a member is only reachable once a device is subscribed: Settings → Notifications has a per-device "Turn on for this device" button (`BrowserNotificationsToggle`) above the grid. No VAPID keys = nobody reachable. Saving and sending both restrict endpoints to FCM, Mozilla Autopush, Apple Push and Windows notification services (`lib/push-endpoint.ts`). Sign-out pauses server delivery and unsubscribes locally while retaining account-specific consent on the device. On the same account's next sign-in, `BrowserPushAccountGuard` silently creates a new subscription and resumes only that account's still-valid server consent (skipped in sudo); another account needs its own explicit opt-in. `paused_at` distinguishes a temporary sign-out from explicit opt-out (`disabled_at`), which automatic resume never clears. Expired endpoints can be replaced under existing consent. Paused devices remain listed and can be removed remotely. Explicitly turning off this device clears its local reminder too. Device operations are serialized to avoid overlapping resume/pause/enroll attempts, and displayed notifications are closed on sign-out. Cleanup failures don't block signing out. The settings toggle is on only when both the browser subscription and the current member's unpaused live device row exist.
- `lib/notifications/registry.ts`: notification kinds (id, category, label, description, default channels). Client-safe; the settings grid renders from it.
- `notification_preferences` (Local layer, migration `20261003160000`): one row per (member, kind, channel) the member changed; no row = the kind's default. Kinds/channels are free text, so adding either needs no migration. Member reads/writes own, admins read, read-only in sudo.
- `createNotifier(supabase, kind, memberIds, { channels? })` (`lib/notifications/notify.ts`): loads preferences and addresses for a batch, then `canReach(memberId)` / `send(memberId, message)`, adding a "Notification settings" link. A failed channel is logged and doesn't stop the others. Check `canReach` before claiming a dedup row so re-enabling a kind still sends. `channels` forces channels and skips preferences, only for sends the member just asked for (admin test DMs).
- `/settings/notifications`: a switch per kind × channel.
- Kinds today: `prickle_checkin`, `prickle_checkout`.

**Next channels** (each = `CHANNELS` entry + adapter + whatever it needs to resolve an address; every notification kind gets it at once):
- In-app: mark one unread again

- Browser/OS: roll Web Push out past the flag; let members name their devices. Settings → Notifications already has a device list (remove one remotely) and a test button; the admin member page shows enrolled devices. iOS needs a home-screen install (16.4+), prompted by `InstallAppPrompt`
- Mobile push: native app later; Web Push covers it until then
- SMS / WhatsApp: important for non-US hedgies; needs a provider (e.g. Twilio), a verified phone number per member, and explicit opt-in (carrier/WhatsApp template rules)

**Still to build:**
- Inbound on the channel layer: a shared shape for replies (member, channel, conversation ref, text or action) so Messaging and interactive notifications don't each parse provider webhooks. Today only Slack replies exist, handled in `app/api/webhooks/slack/interactions/route.ts`.
- Move remaining hand-rolled member messages onto `createNotifier`: payment-failure DMs (below), Host Confirmation Flow (CRM section). Wheel of Wonder's group intro and the Slack sign-in DM stay direct: one is a shared room, the other a transactional reply the member just asked for.
- Staff channel posts as admin notification kinds, so each admin picks their channels: new book (`notifyStaffNewBook`), new award (`notifyStaffNewAward`), new feedback (`app/api/feedback/route.ts`). They post to a shared Slack channel today.
- A `notifications` outbox with async fan-out, once a channel is slow or needs retries (email, push)
- Quiet hours / time zone, and per-member frequency caps across kinds
- Escalation and dedupe: don't email what was already seen in-app; delay-then-send (e.g. email only if a DM is still unread after N minutes)
- Digests: batch low-priority events into a daily/weekly email
- Email delivery tracking: Resend webhooks (delivered, bounced, complaints) and sent/opened/clicked events in `member_activities`

- A per-message "Stop these" Slack button that writes `notification_preferences` (the settings link covers it for now)
- Show on the settings page when a channel can't reach the member (e.g. no matched Slack account)

### Getting started: point the intro step at #start-here, and verify Slack identity _(Idea)_
The tour's newcomer step is "Say hello in Slack" and its reminder links to the Slack channel (`lib/onboarding.ts`, `lib/member-reminders.ts`). Follow-ups:
- **Rename it "Say hello in #start-here"** and link to the in-Hub chat channel (the read-only mirror of the Slack channel, `docs/SLACK_BRIDGED_CHAT.md`) instead of the Slack deep link, once members can post from there. The intro-channel name (`slackIntroChannel` in `app.config.ts`) already drives the text; the link needs the chat channel's route.
- **A "Connect Slack" step in the tour**, using the existing Slack connect OAuth (`lib/slack-connect.ts`, `member_slack_connections`) so we know each member's Slack user id for certain, not by email/name matching (`lib/slack-matching.ts`). Then resolve Slack ids from the verified connection (and `slack_identities`, `lib/slack-sign-in.ts`) before falling back to matching, and use the id from the OAuth/Slack sign-in handshake to confirm it matches what we'd inferred.
- The intro reminder skips members we haven't matched to a Slack user, since we can't see whether they've posted; a verified connection brings more of them in.

### Finish renaming "pre-prickle nudges" to prickle check-ins _(Cleanup)_
Migration `20261003130000` renamed the code, route, cron job and dedup log to check-in/check-out names. Two names stayed because changing them needs steps outside the repo:
- **Checkly heartbeat**: `CRON_HEARTBEATS["pre-prickle-nudges"]` (`lib/cron-heartbeats.ts`) and `CHECKLY_HEARTBEAT_PRE_PRICKLE_NUDGES`. The key is the monitor's logical id (`cron-pre-prickle-nudges`), so renaming it (e.g. to `prickle-checkins` / `CHECKLY_HEARTBEAT_PRICKLE_CHECKINS`) replaces the monitor. Deploy the checks, copy the new ping URL into `.env.prod` under the new var, run `pnpm env:sync`, then remove the old var.
- **Vault secret** `writing_nudge_cron_secret` (cron → route auth; `env-vars.config.ts` destination for `CRON_INTERNAL_SECRET`). Rename the `vaultName`, run `pnpm env:sync:vault`, then a migration that reschedules `send-prickle-checkins` to read the new name. Delete the old secret only after that migration is live.

---

### Big Sisters: message in the Hub _(Blocked on Hub DMs)_

The dashboard card and `/big-sisters` link a new member and their big sister to each other's **Slack** DM (`getSlackDmLinksForMembers`), because Hub chat can't start a conversation yet: `app/(member)/chat/actions.ts` only posts into existing channels, and `chat_channels` has a `dm` kind (Hub-native, always `restricted`, see `docs/SLACK_BRIDGED_CHAT.md`) with nothing that creates one. When Hub DMs exist: add a "Message in the Hub" button to `components/member/BigSisterCards.tsx` (find-or-create the DM with the other member and link to `/chat/<id>`), make it the primary action and keep Slack as the fallback for members who aren't in Hub chat, and point the `big_sister_match` introduction's `url` at the DM. Gate it on the `chat_posting` feature like the rest of chat.

### Chat Files: What Is Still Missing _(Needs Scheduling)_
Chat shows images, GIFs and other files under a message (`docs/SLACK_BRIDGED_CHAT.md`, 2026-10-21). Left for later: files over 20 MB and files hosted outside Slack aren't copied, so their chip answers 404 (link them to Slack's own URL instead, from `bronze.slack_files.raw_payload`); no audio/video players or PDF previews; Slack's legacy `attachments` (link unfurls, bot cards) aren't rendered. Start at `components/chat/MessageFiles.tsx` and `app/api/chat/files/`. Sending from the Hub (`docs/SLACK_BRIDGED_CHAT.md`, 2026-10-22) also lacks: an upload progress bar, showing the message in the list while its files upload (the composer waits), and a bot-path upload that keeps the member's name and photo (Slack's upload API can't set them; the comment carries their name instead, which can leak into the Hub's copy of the text when Slack's echo is projected).

### Prompt Members To Fix Their Own Setup (Reconnect Slack And Similar) _(Needs Scoping)_
When a change needs something from each member, they only find out by hitting the symptom. Example: Slack connections made before `files:write` joined `SLACK_USER_SCOPES` (`lib/slack-connect.ts`) silently upload files through the bot, so the message shows as "Billie Bot" with a "Name:" prefix instead of as the member. The only prompt is a "Reconnect Slack" link on `/settings` (`app/(member)/settings/SlackConnectPanel.tsx`, shown when `hasReadSyncScopes` is false), and its text only mentions read state. **Slack part resolved 2026-10-25** (the `SlackConnectPrompt` bar covers never connected, revoked and out-of-date scopes, and the bot upload fallback it mentioned is gone); the generic "needs attention" list (push subscription gone, no Slack account matched) is still open. Add a proactive nudge when a member's setup is out of date: an in-app notification kind (through `createNotifier`, with `ref` and `resolveInAppNotifications` so it clears once they reconnect) and/or a step in the Getting started tour (`lib/onboarding.ts`) that counts as done from the member's own data. Make it generic (a list of "needs attention" checks: Slack scopes, a dead token revoked by `slack_connection_revoke`, browser push subscription gone, no Slack account matched) rather than one-off, and have the reconnect copy say what the member gains (files, read sync) instead of naming only one. Also consider an inline hint in the composer when a file send falls back to the bot (`postedVia = "bot"` in `lib/chat/slack-upload.ts`). Start a new automated sender in dry run per the notifications rules in `CLAUDE.md`.

### Finish The Required Slack Connection For Chat _(Mostly resolved 2026-10-25; token rotation open)_
Chat requires a connected Slack account (`requireChat`, `docs/SLACK_BRIDGED_CHAT.md` "Access control"). Done: (1) **the member bot fallback is gone**: posting, files and retry use only the member's token (#427); a reaction needs a connection too (`toggleChatReaction` refuses without one, so there are no Hub-only reactions); edit/delete of a message the bot posted for a member before this is refused ("posted by Billie Bot") instead of using the bot. **Kept on purpose:** membership changes (`asMemberElseBot` in `app/(member)/chat/membership-actions.ts`) still fall back to the bot when the acting member's token can't do it, mainly so staff can remove people from a conversation they aren't in; the gate guarantees every connected member has the scopes, and production logs showed no `as member failed` errors in the first days. (Prod had 6 bot-posted app messages and 1 Hub-only reaction on 2026-10-22; they are dead data now, delete with a reviewed statement if they bother anyone.) (2) **Prompting**: `SlackConnectPrompt` (`components/SlackConnectPrompt.tsx`, from the member layout) shows a bar on every member page for someone who has chat but no working connection, worded for never connected, revoked (`getSlackConnectionStatus` now reports `revoked`) and out-of-date scopes, dismissible per session and hidden in Settings; the Getting started step `slack` already existed. Not done, by choice: redirecting at sign-in (a bar is less pushy). **Still open:** (3) **Opt the Slack app into token rotation** before real members connect (irreversible; moves the bot token into the database; see "Token rotation" in `docs/SLACK_BRIDGED_CHAT.md` and `docs/SECRET_ROTATION.md`; `getSlackUserToken` already refreshes rotating user tokens). (4) **Retire name matching** (`lib/slack-matching.ts`): measured 2026-10-25 in production, **1 of 81 active members has connected Slack** (all 81 are matched by name), so matching is still how nearly everyone is linked; revisit once most have connected.

### Mark Chat Read While Reading, Like Slack _(Needs Scoping)_
The Hub marks a conversation read only when the reader leaves it (`components/chat/ChatLive.tsx`: switching conversations, tab hidden, page unload), through the newest message that was on screen. Slack marks read continuously while the window is focused and the newest messages are in view. So reading in the Hub and then switching apps (Cmd-Tab) leaves the Hub marker, and therefore Slack's, where it was, and the Hub hides the open conversation's badge so it looks read. Options, cheapest first: also mark on window `blur` (the same `markChatRead` + Slack push); or mark while focused once the newest message has been on screen for a couple of seconds (more writes, one per view, and the "New" line must not jump while reading, which is why it marks on leave today). Deferred (2026-10-22) because switching conversations already syncs both ways; start at `ChatLive.tsx` (the "counts as read when the reader leaves it" effect) and `markChatRead` in `app/(member)/chat/actions.ts`.

### Chat Drafts, Synced With Slack _(Needs Scoping)_
Save unsent message text per conversation (and per thread) in Hub chat, so leaving a channel or an expired session doesn't lose it. Slack keeps drafts too; sync both ways with the Slack bridge (`docs/SLACK_BRIDGED_CHAT.md`) so a draft started in Slack shows as unsent in the Hub and the reverse, and show "Drafts" in the chat list. Check which Slack API exposes drafts (and whether the bot or a member token is needed) before designing. Related: session expiry mid-form under "Return To".

### Chat Message Menu: Edit/Delete And The Rest _(Needs Scheduling)_
The ⋮ in a message's hover bar (`components/chat/MessageActions.tsx`) has only Copy link and Copy message. Left for later: (1) Edit and Delete are still inline buttons under a member's own message (`components/chat/MessageBody.tsx`); move them into the menu, which means lifting the view/edit/confirm-delete state out of `MessageBody` so the menu can start it. (2) Slack's other entries aren't supported: Mark unread, Add to saved, Add a reminder, Get notified about new replies, Pin to channel, Connect to apps, and the hover bar's Forward and Add to-do. Each needs its own feature first (the read marker only moves when the reader leaves a conversation, there are no saved items or pins), so add them one at a time as those land.

### Chat Emoji Picker: Skin Tones And Keyboard Grid _(Needs Scheduling)_
**Resolved:** skin-tone chooser in `components/chat/EmojiPicker.tsx` (remembered per browser, applied as `name::skin-tone-N`, shown toned by `Emoji`), roving-focus arrow-key grid, and custom emoji lists split into `content-visibility` chunks with lazy images.

**Resolved (phones):** the quick-reaction row is gone; the add-reaction button opens the full picker, with Frequently used seeded from the old quick set, as a bottom sheet with backdrop and close button below `sm`, nudged back inside the window above it.

**Still open:** true virtualisation if a workspace passes tens of thousands of custom emoji; toned emoji inside message text (`:name::skin-tone-N:` still renders untoned); recents live in localStorage per browser, not per member.

**Still open (small UX):** the picker shows "Loading…" instead of its Frequently used row until the big emoji data (`emojibase-data`, a dynamic `import()` in `loadCatalog`) arrives, although recents are just shortcodes and need no catalog to render. Draw the recents (and the custom emoji) right away and load the catalog only for browse and search. Found while fixing a `MessageList` test that raced that import (PR #372). Start at `components/chat/EmojiPicker.tsx` (`catalog` state, the `!catalog` branch near the bottom); a component test can assert the recents render before the catalog resolves.

### Chat Reply Count Isn't Decremented When A Reply Is Deleted _(Mostly resolved)_
**Resolved:** `reply_count` and `last_reply_at` already exclude deleted replies in every path (`chat_delete_message`, the reprocess window and the single-message projection in `20261204000000_chat_author_follows_matching.sql`); prod check: 763 thread roots, none mismatched, so no backfill. A deleted root that still has live replies now stays in the feed as "This message was deleted." with its replies link (and heads the thread panel the same way), so the thread is reachable; a deleted message without replies is not shown (`buildMessageViews`, `MessageItem`).

**Resolved:** the sidebar (`components/chat/ChatSidebar.tsx`) listens for message updates that set `deleted_at` and, debounced, re-reads that conversation's count from `chat_unread_counts`, so the badge drops in realtime without double-counting.

### Chat Custom Emoji: One Request Per Image _(Needs Scheduling, only if it becomes slow)_
`Emoji` (`components/chat/ChatText.tsx`) renders each custom emoji as its own `<img>` pointing at Slack's CDN URL (`bronze.slack_custom_emoji`, via `lib/chat/names.ts`), lazy and async-decoded, and the picker (`components/chat/EmojiPicker.tsx`) only renders chunks near the viewport. Standard emoji are Unicode text and cost no requests. Prod has 464 custom emoji (checked read-only), so scrolling the Custom tab means a few hundred small requests spread over the scroll; fine today. Deferred because it only matters if the set grows by an order of magnitude or Slack's CDN is slow. If it does, in order of effort: (1) serve thumbnails through our own resizing proxy or `next/image` so every image is a small, cacheable file we control; (2) generate a sprite sheet of the custom emoji at import time (`lib/slack-capture.ts` already copies files) and render with background-position; (3) true virtualisation of the Custom tab (render only visible rows). Start by measuring request count and bytes for the Custom tab before choosing.

### Chat Thread Replies Aren't Grouped _(Needs Scheduling)_
In the conversation, a message from the same person within five minutes of the previous one drops its avatar and name and shows its time on hover (`groupByDay` in `lib/chat/days.ts`, used by `components/chat/MessageList.tsx`). Replies in a thread panel (`components/chat/ThreadList.tsx`) never get that, so every reply repeats the avatar and name. Reuse `groupByDay`'s follow-up rule there (no day markers) and pass `compact` to `MessageItem`.

### Chat Visual Tests: Day Marker And Hover Bar _(Needs Scoping)_
The sticky day marker (opaque, flush to the top of the message pane) and the hover action bar are layout and CSS behavior that the jsdom component tests can't see: two regressions there (a transparent marker, a gap above it) were only caught by looking at the real page. There are no Playwright or other browser tests in the repo today. Decide whether to add a small Playwright suite (a seeded conversation spanning several days, scrolled past a day boundary, viewport widths either side of the sidebar breakpoint, hover on a message) or screenshot checks; start from `components/chat/MessageList.tsx` and `components/chat/MessageActions.tsx`.


### Chat Switching Speed: What Is Left _(Needs Scheduling)_
Switching conversations was a full server render with nothing on screen until it finished. Done: a loading skeleton for a conversation and for message search, the page's queries run in parallel, `experimental.staleTimes.dynamic: 30` in `next.config.ts` (app-wide) so a revisit is served from the client cache, and a cached conversation catches itself up on mount (messages and the unread line, `components/chat/ChatLive.tsx`). **Resolved since:** the page logs where its time goes (`[chat] page` lines, `lib/chat/timing.ts`; read them with `vercel logs --project hub --query "[chat] page"`), `buildMessageViews` is two stages instead of four, rarely-changing Slack lookups are cached for 5 minutes (`lib/chat/lookup-cache.ts`), the sidebar prefetches the conversation about to be opened, and the layout and page share one read of the channel list on a full load. First production numbers (20 renders): median about 600ms server time, `requireChat` 90-260ms, the channel list usually the longest query in the parallel stage (120-230ms), `views.batch1` 40-500ms with two ~2.7s outliers still unexplained. Functions (`cle1`) and the production database (`us-east-2`) are in the same area. **Still open:** (1) measure on a phone; the logs only cover the server. (2) The bigger step is a client-driven shell: messages fetched per conversation on the client with a per-conversation cache that is shown at once and revalidated, which is what makes Slack feel instant; only worth it if (1) shows the server render still dominates. (3) The `staleTimes` window can show up to 30s old data on any page whose data changes without a server action calling `revalidatePath` (API routes, webhooks, and member actions with none: `app/actions/in-app-notifications.ts`, `app/(member)/wheel-of-wonder/actions.ts`); audit those, or move the window to a per-route `cacheLife` stale time if the app adopts Cache Components. (4) When the unread line moves after a cached catch-up the reader is not scrolled to it. (5) Mobile browsers discard background tabs and reload on return; check that chat responses don't send `Cache-Control: no-store` (which keeps a page out of the back/forward cache) and that a cold load restores the last conversation (the `LAST_CHAT_COOKIE` already does).

### Lesson Comments on Courses _(Needs Scoping)_
Ania wants comments on lessons, mainly so instructors can answer questions in place. The design is in `docs/COURSES.md` ("Lesson comments") and its six decisions were made on 2026-10-28 (see "Decisions" there), so it is ready to build but not started. Start with phase 1 of that plan (`lesson_comments` table with the `cmnt_` id prefix, RLS and pgTAP, the thread on the lesson page, the unanswered-questions admin list) behind a feature flag. Deferred by decision: **mentions and video timestamps** (phase 4, after the first release). The `cmnt_` prefix is chosen (`cmt_` is `prickle_commitments`). Still to decide with Ania: what a member sees after access ends, which may vary by course (see "Open decisions" in `docs/COURSES.md`); comments are hidden with the course either way. **Kajabi comments will be imported (decided 2026-10-30)**, not skipped: see "Kajabi migration" under "Lesson comments" in `docs/COURSES.md`. It needs phase 1's `lesson_comments` table first, and a source nobody has looked at: Kajabi's public API has no comments, so the first step is `courses:content --probe` on the admin page where comments are listed or moderated, then a `--comments` capture like `--progress`. Until then an admin view must show "not imported", never 0.

## Slack Bot Channel Access

### Auto-invite Billie Bot into private channels using a personal Slack token
Billie Bot (this app's own Slack bot) can't invite itself back into a private channel it's been removed from — Slack has no self-invite API, and an app also can't discover private channels it's not currently a member of. `lib/private-channel-access.ts` works around the discovery half by detecting staleness in `bronze.slack_channels.imported_at` (a private channel that stops getting refreshed by the nightly Slack import means Billie Bot lost access) and surfacing it on `/admin/hygiene` — but that's alert-only; nothing can currently fix it automatically.

**Idea:** Use a personal Slack user token (a `xoxp-...` token for Cody's or Ania's own account, pulled from the browser session rather than a proper OAuth flow) to close the gap. A real user's token can see every private channel *they're* personally in via `conversations.list`, and `conversations.invite` only requires the inviter to already be a member — so it could add Billie Bot into any private channel the token's owner is in that Billie Bot is missing from, without waiting on a human to do it by hand in Slack.

**Why this isn't built yet:**
- Much less automatable than the bot-token flows elsewhere in this app — a personal token isn't provisioned like `SLACK_BOT_TOKEN`; getting one means manually extracting it from the browser, and it's tied to a real account (breaks on password change, "log out everywhere," etc. — no clean rotation story).
- Only covers private channels the token owner happens to be in, not necessarily every private channel Billie Bot should be in.
- Reads more like a manual/one-off remediation script than infrastructure that belongs on an unattended nightly cron.

**If pursued:** probably a manual/on-demand admin action (e.g. a button on `/admin/hygiene` next to the stale-private-channel list, invoked with a short-lived personal token pasted in at the time) rather than another cron, given the personal-token risk above.

---

## Gamification / Badges

### Community Builder Leaderboard
Recognize members who contribute most to community engagement — inspired by Long Angle's leaderboard (https://my.longangle.com/leaderboard). **Note:** Long Angle's own leaderboard ranks by number of members invited/referred, not general engagement — worth deciding whether to mirror that directly (an invites leaderboard) or broaden to community engagement generally.

Possible signals to rank on:
- Invites/referrals sent (Long Angle's actual model)
- Prickle attendance count or total hours
- Slack messages/reactions
- PUPs started or hosted
- Streak length (consecutive weeks active)
- Composite engagement score (see CRM Features / Engagement Scoring)

Considerations:
- Member-facing (public to the community) vs. admin-only view
- Time window options (all-time, last 30/90 days, current month)
- Opt-out mechanism so members who don't want to appear can hide themselves

### Verified Service Provider (VSP) Badges (Needs Scoping)
Ania wants a badge recognizing members who are verified service providers to the community, abbreviated per category — e.g. "VSP Editor", "VSP Coach" — rather than one generic "VSP" badge.

**What already exists (reusable):** the full badge pipeline from the Multi-Product Support & Badges work above — `badge_types`/`badge_levels`/`member_badges` schema (`supabase/migrations/20260831000001_create_badges.sql`), `lib/badges.ts` (earned-badge computation, manual vs. automatic), `components/BadgeChip.tsx`, and the `/admin/badges` CRUD UI. No VSP-specific code exists yet — this would be a new `badge_types.category` value plus one or more seed rows, not new plumbing.

**Needs scoping before implementation:**
- `badge_types.category` is currently a `CHECK` constrained to `('milestone','community','course','retreat','special')` — needs a new value (e.g. `service_provider`) added to the constraint, or decide `special` is close enough to reuse
- One badge type per category (`VSP Editor`, `VSP Coach`, ...) vs. a single "VSP" badge type with a category sub-label — affects whether this is a handful of new `badge_types` rows or a schema change to `member_badges`/`badge_types` to carry a free-form category alongside the type
- Verification process: who marks a member as a verified provider, and for which categories — likely manual (`is_automatic=false`) like other non-criteria badges, awarded via the existing `/admin/badges/[id]/recipients` flow, but the list of valid categories needs to come from Ania
- Display: profile-only, or also surfaced on admin member list/detail and the community directory (if one exists)?

### PUP-Starter Badge
Recognize members who drive spontaneous collaboration by being the first to join (or most frequently starting) Pop-Up Prickles.

Two possible definitions:
1. **First joiner** — member with the earliest `join_time` in `attendance` for a given PUP
2. **Most frequent caller** — member who initiates the most PUPs (may need Zoom host data or a `called_by` field on prickles)

### Awards & Competition Tracking
Track external competitions (awards, contests, anthologies, showcases) that members submit their writing projects to. Members currently share these informally in the `#hedgie-classifieds` Slack channel; no structured tracking existed before Phase 1 below.

**Phase 1 — record wins: Resolved.** `member_awards` table (`supabase/migrations/20260914000000_create_member_awards.sql`) — `award_name`, `category` (free text, doubles as placement/tier e.g. "Gold Medal — Romance"), `work_title`, optional `book_id`/`project_id` links to `member_books`/`writing_projects`, `award_date`, `url`, `notes`. Same LOCAL-layer, self-report RLS shape as `member_books` (member manages own rows, admin bypass for sudo, every authenticated user can view). Self-service "My Awards" panel lives on `/projects` (`app/(member)/projects/MyAwardsPanel.tsx` + `components/awards/AwardFormModal.tsx`, actions in `app/(member)/awards/actions.ts`), mirroring the existing "My Books" panel. `notifyStaffNewAward` (`lib/slack.ts`) posts to a staff Slack channel on each new win, gated behind `SLACK_NEW_AWARDS_CHANNEL_ID` (unset today — silently no-ops until that env var is added, same pattern as `notifyStaffNewBook`/`SLACK_NEW_BOOKS_CHANNEL_ID`). Deliberately scoped out of Phase 1: no public community-facing "Awards" gallery page (unlike Bookshelf) and no admin-side display — staff visibility is via the Slack notification for now.

**Phase 2 — submission tracking, not just wins:** record *submissions* too, so both per-member and aggregate win-rate stats become possible ("submitted 8, won 2"). Needs a submission status (submitted / longlisted / shortlisted / won / rejected) rather than a boolean, and a submission date separate from any result date.

**Phase 3 — internal award list / PR campaign tracker:** a curated list of known competitions (name, submission deadline, eligibility, categories) members can track against as part of their own PR/marketing push, and staff can use to prompt members ahead of deadlines. Could be seeded from what shows up in `#hedgie-classifieds`, but that's manual curation, not an automated import — the existing Slack import ingests channel messages into Bronze, but "is this message announcing a competition with a deadline" isn't something the pipeline classifies today.

**Badge tie-in:** an "Award-Winning Author" badge, reusing the existing badge pipeline (`badge_types`/`member_badges` — see Multi-Product Support & Badges and VSP Badges above), likely auto-derivable once Phase 1's win record exists, the same pattern as the retreat/program badges.

**Sequencing:** Phase 1 (mark wins) stands alone and should ship before Phases 2-3; win-rate stats and the internal deadline-tracking list are natural follow-ons once win-tracking exists, not prerequisites for it.

**Priority:** Not scoped yet — idea only, no code started.

---

## Member Profiles

### Public Pen Names ("Also writes as …") _(Idea)_
Let members choose which of their alternate names show on their public profile. Today the only public name is `members.display_name` (the "default pen name", used as the profile heading via `getMemberDisplayName`). Other pen names live in `member_name_aliases`, mixed in with internal Zoom/Slack matching names that can include typos or legal names, and RLS only lets a member read their own aliases (`20260831180000_add_alias_self_service.sql`) — so they can't be shown to other members as-is.

- **Schema:** add an `is_public` boolean to `member_name_aliases`, default `false`, so nothing becomes visible without an explicit opt-in (existing aliases stay private).
- **Settings → Identity:** a "Show on my profile" toggle next to each alias the member added themselves.
- **Read path:** serve only public aliases through a narrow read (e.g. a view or `SECURITY INVOKER` function returning just `member_id` + alias text for `is_public = true`) rather than loosening the table's RLS, so matching-only aliases never leak.
- **Profile:** list them under the heading as "Also writes as …".

**Priority:** Not scoped yet — idea only, no code started.

### Member Emergency Contact _(Idea, Not a Priority)_
A member (early adopter) pointed out that if a Hedgie has an urgent health issue or emergency on a Zoom, hosts wouldn't know who to alert or how. Idea: members optionally save an emergency contact in settings, hidden from other members, which a host can reveal in an emergency without waiting for staff. Nothing built; deferred as not a priority.

Decisions so far:
- **Storage:** nullable `emergency_contact_name`, `_phone`, `_relationship`, `_note` columns on `members`, not a new table. `members` is already own-row-or-admin RLS (`20260926000700_restrict_member_readable_data.sql`), so other members can't read them, and Hub-owned columns that `reprocess_members_atomic` ignores have a precedent (`20260906020000_add_member_birthday.sql`). Keep them out of `member_directory` and the shared profile column list in `lib/data/members.ts`; give the repository its own read/write method.
- **Admins** may see it (members aren't worried about that); the concern is other members.
- **No country / local emergency number:** we can't call another country's emergency services anyway, so only the contact is useful.
- **Reveal:** a host (or admin) of a prickle can reveal the contact of someone currently attending it, with no staff in the loop. Hosts can't read `members` rows, so it is a server action using the service role after checking host/admin and an open attendance record. A prominent warning dialog comes before the reveal (real emergency only, the member will be told, it is recorded).
- **After the reveal:** a row in a service-role-only `emergency_contact_accesses` table (who, whose contact, which prickle, when); an immediate, non-opt-out notification to the member through `createNotifier` (new kind, with its sample message and email template); a staff alert (pattern in `docs/SLACK_OPERATIONS_ALERTS.md`). The member can see their own access history in settings.
- **Docs:** a host emergency protocol (local emergency services first, then the contact, then tell staff) in `/help` and `docs/`. If this is built, the protocol ships with it.
- **Plan:** two PRs: (1) columns, settings form, docs; (2) reveal, access log, notification, alert. Tests: pgTAP for the columns and log table, server-action tests for refusal (non-host, not attending), log, notification and alert, and an analytics event with no property that could hold the values.

**Priority:** Not a priority; pick up when scheduled.

---

## Analytics & Matching

### Best Feedback Friend (BFF) program: enrollment and matching in the Hub _(Needs Scheduling)_
Today a member joins the BFF program (quarterly enrollment, a quarter-long commitment: read each other's work, meet at least monthly, give reinforcing and constructive feedback) by filling out an external **BFF interest form**, and the pairing is done by hand from the answers. The Hub has no BFF screen, table or notification; the only trace is the BFF Program as a Kajabi product (`docs/TODO.md`, "Multi-product" notes) and the "Former BFF"-style labels below. The Kajabi lessons "How to get a BFF" and "What to expect in the BFF Program?" (a draft that only points to an attached document) stay in Kajabi until this exists, so there is no help article.

**Why deferred:** it's a program with a matching decision (compatibility, availability), not a form, and the shape isn't settled. **Where to start:** an enrollment window (open and close dates, per quarter), an interest form in the Hub (replacing the external one), a pairing table (two members, quarter, status, `deleted_at`) written by an admin, a member page for "my BFF", and a notification kind (`lib/notifications/registry.ts`) when a pairing is made. Once it exists, write the help article from the real screens (a demo scene, `help/`, `HELP_ORDER` in `lib/help.ts`). Related: "Analytics & Matching" below (matching signals), `docs/BIG_SISTERS.md` for a pairing program that already exists.

### Member Interactions: Who Replied to Whom _(Parked, Refinement)_
`member_interactions` (Silver, `20261212000000`, `docs/SLACK_BRIDGED_CHAT.md` phase 3 part 12) is a derived table of who talked with whom in chat (thread replies, DMs, reactions, mentions; who, toward whom, where, when, public or private; never content). It feeds the admin member network graph (`/admin/members/network`, chat off by default for prickles-only, `?chat=public|all` to add it). It is built and rebuilt by `/api/process/member-interactions` from the chat tables.

**Parked: refining who a thread reply is *for*.** Today every reply points at the thread's author. Slack doesn't record who a reply is meant for, and that rule has two known biases: it makes the thread's author the hub of every conversation, and it misses the back-and-forth between everyone else (A answering B's comment). Mentions (`<@U..>`) say who a message names, but not why:
- `@sarah the answer is…` is addressed to Sarah;
- `like @sarah mentioned`, `I agree with @sarah` refer to something Sarah said, so the reply is to an earlier comment;
- `you should ask @sarah` is a referral, not a reply to her;
- a bare `@sarah` is an invitation to a conversation she hasn't joined.

**Tried and set aside:** a layered rule (a reply that tags someone is for them; else if the replier was tagged and hasn't posted since, for the tagger; else for whoever spoke last; else nobody), written, tested (27 pgTAP assertions) and closed unmerged as PR #330, branch `worktree-chat-thread-rule`. It rests on the first step, which the examples above show is wrong about half the time.

**If it's picked up:** classify *how* a mention is used (position and wording of the tag, e.g. at the start of the message or after a referral phrase; or a small model over the message text, run offline), weight an interaction by that confidence instead of counting it as 1, and use "whoever spoke last" only for a reply with no tag at all. Possibly cap one pair's contribution within one thread (a long ping-pong) if a few chatty pairs dominate. `channel_comember` (sharing a conversation) was left unbuilt on purpose: pairing every member of a big channel is quadratic and says little.

**Why parking costs nothing:** the table is entirely derived from `chat_messages`, `chat_message_contents` (kept, including for deleted messages), `chat_reactions` and `chat_channel_members`, all of which keep their full history. Any change to the rule can be rebuilt over any date range afterwards (`POST /api/process/member-interactions` with `fromDate`/`toDate`), so nothing is lost by waiting.

**When to revisit:** when staff use the graph with chat turned on and find its chat edges misleading (a few members looking like hubs). Until then the simple rule is enough, and the default view doesn't include chat.

### Member Matching Logic (In Progress)
Build fuzzy matching to connect Zoom attendance to members when emails aren't available:
- Name normalization (nicknames, variations)
- Manual mapping table for common aliases
- Confidence scoring

### Zoom Name Matching: Options Beyond Aliases _(Needs Scoping)_
Checked against prod on 2026-10-24 (counts only): 7.1k attendee rows since January, about 94% matched by alias, email or full name (the first-name rules in `lib/member-matching.ts` match more), 88 active Zoom aliases covering 70 of 82 active members, 20 distinct ambiguous names.

**What doesn't work as an identity key.** Zoom's participant report gives a stable id only for people in our own Zoom account. Everything else was unusable: `participant_id` is empty, `registrant_id` and `customer_key` are never set, the payload's `participant_user_id`/`id` are filled on about 2% of rows with 2-3 distinct values, and `user_id` is a recycled per-session slot (131 distinct values; 52 of 90 matched members appear under 10 or more of them). Emails come back on 3% of rows even with "Only authenticated participants can join" on, because Zoom hides external users' emails from reports (`/docs/api/using-zoom-apis/#email-address-display-rules`). So connecting a member's Zoom account (OAuth) gives us their Zoom user id, but nothing in the attendee data to join it to.

**What OAuth could still do** (not built): with a user-level app, `GET /users/me` (`user:read`) returns the account's `display_name`, so Settings > Identity could show "your Zoom name is X, your Hub name is Y" and create the alias on confirm; `PATCH /users/me` (`user:write`) can set `display_name` to the Hub name. Both only help someone who joins signed in to that Zoom account (a guest or a different device still shows whatever name they typed). Our members are not on our Zoom account, so a *private* or *internal* app won't do (those are limited to users on the developer's own account); it has to be *published*, listed or unlisted, and Zoom reviews both (Zoom's docs: "Before you build > App types", and the app review process); a *beta* app reaches a limited number of outside users for a limited time. Unlisted still needs the listing metadata (images, description, categories). So it's an app-review project, not a quick integration. **Done:** the cheaper first step: the Getting started tour's Zoom name stop now says to set your Zoom name to your Real Name or add the name you use in Zoom, and a name can't be added if it's already yours or belongs to another member (`name_alias_conflict`, `20261223000000`).

**Other routes that put identity into the attendee record:** registration on the recurring meetings (gives a registrant id and email), or per-member join links. Both add friction at join time.

**Nudge by elimination (not built):** a member completed a prickle check-in but has no matched attendance for it, and that prickle has an unmatched or ambiguous Zoom name: ask the member "were you 'X'?" and add the alias on yes. Weak when a prickle has several unmatched names or several missing members, and blind to drop-ins (no check-in is sent to them), so it must stay a suggestion the member confirms. Revisit once launched, if `member_name_aliases.source = 'member'` shows members aren't setting names themselves.

**Admin alias paths: done.** `/api/aliases`, `/api/zoom/resolve-ambiguous`, `PATCH /api/admin/members/[id]` (new pen name; keeping the old name when renaming) and `/api/admin/apply-aliases` now run `name_alias_conflict` too and refuse with whose name it is (409). **Still open:** merge, split and move-aliases move existing alias rows between members without the check (deliberate reassignments); an admin who really means to give a name that is another member's real name to someone else has no override (move or rename that member first); the member-facing check can't tell a first name shared by several members (a single-word alias like a first name is allowed, and then claims every Zoom join under that name).

**Resolved:** `ambiguous_zoom_names` collected one row per reprocess instead of one per name (a NULL email defeated its unique constraint); fixed by `20261222000000_ambiguous_zoom_names_null_email_unique.sql`.

### Slack Name → Member Lookup Tool (Needs Scoping)
Staff currently resolve an unknown Slack display name/nickname to a member by hand: search Slack, guess at a real name, then search Kajabi/Hedgie Hub by email. Came up while bootstrapping member birthdays from a hand-maintained sheet of Slack names — the fuzzy matcher (`lib/member-matching.ts`, `suggestMemberMatches`) plus the alias tables (`member_name_aliases`, `member_email_aliases`) already have most of what's needed to do this automatically; there's just no UI for an ad-hoc "who is this Slack name" lookup outside the existing unmatched-Slack/ambiguous-names reconciliation flows (which only cover names Slack/Zoom processing has already flagged).

**Possible shape:** a small admin search box — paste a name, get back ranked candidate members (name/email/status) using the same matching logic, with a one-click "add as alias" action. Could live alongside `/admin/hygiene/unmatched-slack` or as its own lightweight tool.

**Priority:** Not scoped yet — came from a one-off bootstrap task, not a recurring pain point (yet).

### Marketing site → Hub attribution via GA browser ID _(Needs Scoping)_
Hub and the marketing site (www.quillandcup.com, on Kajabi) are separate GA4 properties, so GA's own reports can't show "visited the sales page, then joined Hub". GA's browser ID (the `_ga` cookie) belongs to the website domain, not to a property, so two properties on quillandcup.com normally share one ID, and PR #100 already stores it on every `access_events` row (`ga_client_id`, the value GA4's BigQuery export calls `user_pseudo_id`). That makes cross-site attribution a join in our own data, not a GA report.

**Shape:** turn on GA4's free BigQuery export for the marketing site's property and join its `user_pseudo_id` to `access_events.ga_client_id` to attribute each member's marketing-site visits (first touch, pages seen, campaign) to the member they became. Needs the next item first.

**When to switch approach:** once the sales funnel moves into Hub, Hub *is* the marketing site; at that point add Hub as a second web stream in one property (Google's standard multi-site setup) so GA shows the whole journey, and this join goes away.

**Needs:** the marketing site's GA cookie working (below), a BigQuery project, and a decision on retention/privacy for the joined data (it ties anonymous marketing visits to a named member).

### Why the marketing site sets no GA cookie _(Investigate)_
On 2026-10-17, signed out in Chrome, `www.quillandcup.com` loaded Google's tag scripts (`gtag/js` and `gtm.js`, so a Tag Manager container is involved) but had **no `_ga` cookies**, while `hub.quillandcup.com/login` had the cookie plus four per-property session cookies. So the shared browser ID that cross-site attribution relies on isn't being set there, at least in that browser.

**Check, in Kajabi and the container:**
- Whether Kajabi's GA setting (Settings → Marketing/Analytics) or the Tag Manager container actually fires the GA4 tag for the "Quill & Cup Website" property, and on which pages.
- Whether a consent setting (Kajabi's cookie banner, or Consent Mode in the container) is holding analytics storage at "denied" until the visitor accepts.
- Whether the tag is configured with a cookie domain that isn't quillandcup.com (GA defaults to the whole domain, which is what lets properties share the ID).
- Repeat the check in a fresh profile after accepting any banner, to separate "never sets it" from "waiting for consent".

**Done when:** a visitor to the marketing site gets a `_ga` cookie scoped to `.quillandcup.com` that Hub then reuses (compare `ga_client_id` on their first Hub visit).

---

## Live Page (Who's in the Prickle Right Now)

Show a `/live` page displaying the currently active prickle and its attendees in real time.

**What was built and reverted:** A server-rendered `/live` page with 30-second auto-refresh querying `prickles WHERE start_time <= now AND end_time >= now`, plus attendee lists split into "currently present" vs "was here earlier". Reverted because attendance data isn't available during live sessions.

**The blocker:** `prickle_attendance` (silver layer) is populated from Zoom reports, which are only available *after* a meeting ends. The page would always show 0 attendees during an active session.

**The Zoom webhook gap (partly closed):** `/api/webhooks/zoom` now records every `meeting.participant_joined` / `meeting.participant_left` event in `bronze.zoom_participant_events` (migration `20261003150000`), and `lib/zoom-presence.ts` pairs them into per-member presence intervals, matched with the attendance import's rules. The prickle check-out DM already uses it. The live page can build on the same table and helpers instead of the `live_participants` table sketched below (steps 1, 2 and 5 are done; "currently present" = an interval with no leave).

**What's needed to build this properly:**

1. **Handle `meeting.participant_joined` in the Zoom webhook** — write to a lightweight `live_participants` table (not part of the silver pipeline). Schema: `(meeting_uuid, zoom_user_id, name, join_time, left_at TIMESTAMPTZ nullable)`.
2. **Handle `meeting.participant_left`** — set `left_at` on the matching row (already triggers the full import, which can remain).
3. **Handle `meeting.ended`** — clear all rows for that `meeting_uuid` from `live_participants`.
4. **Match live participants to prickles** — join `live_participants.meeting_uuid` to `prickles.zoom_meeting_uuid` to know which prickle is live.
5. **Match live participants to members** — reuse the existing alias/email matching logic to resolve `zoom_user_id` or name to `members.id`.
6. **Update the live page** — query `live_participants` instead of `prickle_attendance` for who is currently present, fall back to `prickle_attendance` for "was here earlier."

**Alternatively (simpler but less real-time):** On `meeting.participant_joined`, immediately trigger the Zoom import (Zoom's live participant list API is available mid-meeting). This would populate `zoom_attendees` and then reprocess attendance, showing joined participants with no leave_time set yet.

**Priority:** Low — the page itself is simple; the prerequisite is wiring up real-time Zoom participant data.

---

## UI Enhancements

### Sidebar auto-hide: pin and wider rollout _(Needs Scheduling)_
Chat now rests the member sidebar as an icon rail that opens over the page on hover or focus (`components/MemberNavigation.tsx`). Deferred until members have used it: a pin button with a per-member preference to keep it open, and whether other pages with a second pane should do the same. The admin sidebar (`AdminNavigation.tsx`) is unchanged; change all three navigation files together if the behavior spreads.

### Managing events in the Hub: the rest of the plan _(Needs Scheduling)_
**Done:** prickle types have separate dimensions, edited on the prickle type: `listed_in_events` (webinars, Hedgies on First, Monthly Goal Review and pitches show on the member Events page), plus `announced_publicly` and `guests_allowed`, stored but not read by any page yet. **Still open**, from a conversation with the community lead, in the order to build it:
1. **Events model: what's left.** **Resolved:** more kinds of event (workshop, book launch, social besides the retreats and "other"), and the audience fields on `events` (`announced_publicly`, `guests_allowed`, `registration` none/signup/application, `capacity`, `selection` first come or hosts choose, free-text `speakers`), edited on the admin create/edit forms and shown on the member event page. The id default and admin-only write policies were already in place. **Still open:** time of day (events are date-only; a webinar or book launch with a time is a prickle listed in Events for now), guest speakers as members rather than text, an image picked from a per-kind default set or uploaded (events have a photo gallery and no cover image), `kinds` as a table with default images and flags if the list keeps growing, and `announced_publicly` is stored but nothing public reads it.
2. **Registration and application.** A registrations table (member, event, status `registered`/`applied`/`accepted`/`waitlisted`/`declined`, application answers) for the workshop that needs an application (a query workshop with two sessions attendees must both attend) and sign-ups. Notifications go through `createNotifier`.
3. **Calendar-linked events and series.** **Resolved:** how a calendar item becomes an event (a listed prickle type, `#event` in its Google Calendar description, or "Show in Events" by hand on the admin prickle page), what follows the calendar and what is the Hub's, automatic events being removed again when their reason stops applying, and removing an event from Events are in `docs/CALENDAR_EVENTS.md` (`lib/calendar-events.ts`, `/api/process/calendar`). Titles are cleaned ("Quill & Cup [Category] Prickle: Title with Speaker" -> "Title") and a Zoom URL location shows as a join link (`calendarTitle` in `lib/calendar-events.ts`, `lib/location-display.ts`; see `docs/CALENDAR_EVENTS.md`). **Editing, in progress (single source of truth for prickles that are events):** the prickle details page has an Edit button for title, description, type, host and guest speaker, kept as overrides that survive reprocessing (done). An event made from a prickle takes its title, description, guest speaker and host from the prickle and its name carries the host or speaker (done). The admin event page has the same Edit-then-Save style: each value turns into its field in place (done). A prickle has no location, so a prickle-event's location is still an override on the event. **Still open:** matching a calendar item to a prickle type from the Events side (today only on `/admin/hygiene/unmatched-events`; the same resolve routes can serve both); calendar items that are no prickle can only be reached by tagging them `#event` in Google Calendar; a link from an event to its prickle page (and back) for events that are prickles; times of day on the member Events pages (`events.start_time`/`end_time` are stored, the cards and page show dates); per-prickle-type defaults for the Hub-only metadata (image, audience) that each automatic event would inherit, so a recurring session doesn't need it entered every time; writing title, description and location back to Google Calendar instead of overriding them (needs the write scope in `lib/google-calendar/client.ts`, now `calendar.readonly`, and the service account shared on the calendar with "Make changes to events"; the Hub-only metadata stays in the Hub either way); a nullable `parent_event_id` for a group of events (book fair slots, a writing marathon); letting an admin override more than title, description and location; past sessions of a listed prickle type are not made into events (only tagged ones are), to keep Past from filling with a recurring series.
4. **Programs.** Challenges (an invitation, opt-in, held accountable in a channel, a badge, possibly a word-count project) are closer to `programs` and cohorts than to events; an event could point at a program. A book launch is more an announcement, celebration or recognition than something to show up to, so it may belong with those rather than as an event; it shows under Special events for now. Book launches ("releasing in 10 days", pre-orders open) and a "where are you in the process" badge (drafting, editing, querying) are separate ideas to scope.
5. **Public listing.** Only members see Events today. A signed-out page for announced events with guest registration needs email capture, anti-spam and an unsubscribe path.

**Why deferred:** each step is its own PR (this one only generalized the educational-prickle list); the audience flags and the program/event boundary were agreed in principle, not yet confirmed with the community lead. **Where to start:** `supabase/migrations/20260905000000_create_events_and_event_photos.sql`, `app/(member)/events/`, `app/(admin)/admin/events/`, `lib/events-filter.ts`.

### Events and prickles: one schedule, later sub-events and write-back _(Needs Scheduling)_
**Done in the prickle/event split PR:** an event stands on exactly one prickle (`events.prickle_id`); its title, description, host, speaker and times are read from the prickle, not copied; the admin event URL is the slug, like the member one. **Still open:**
1. **Sub-events.** A book fair, a writing marathon or a retreat is an event with sessions (author spotlights, agenda items, each its own calendar item). The model for it is a Local `event_sessions` table (`event_id`, `prickle_id` unique) so Silver `prickles` never points at Local; an event's dates are the earliest start and latest end of its sessions, its agenda the list of them. Attach a calendar item by an `#event <slug>` tag in its description or from the prickle page. This replaces the single `prickle_id` and the `parent_event_id` idea in "Managing events in the Hub".
2. **Write back to Google Calendar.** An event made in the Hub gets a `prickles` row with `source = 'hub'` that the calendar sync leaves alone, because there is no calendar item to build it from. Writing events to Google (the write scope in `lib/google-calendar/client.ts`, the service account shared with "Make changes to events") lets the Hub create the calendar item and the normal sync make the prickle; then drop `source = 'hub'`.
3. **Announcements.** A book launch is mostly an announcement with its own dates (pre-orders announced, pre-orders open, release), a visibility window and no sessions; a live launch party is an event. Announcements are not events or prickles, so they get their own model when someone builds them.
4. **Admin links that still carry the event id.** The admin event page address is the slug, but the member badges panel, the media editor's usage list and the Google Photos sign-in return still link `/admin/events/<id>`; the page redirects an `evt_` id to its slug, so they work. Pass the slug where they have it (`MediaUsage` for events carries only the id) and drop the redirect once nothing sends ids.
5. **Event photo import and attendee API routes** keep taking the internal event id in the path (our own client only); fine until an external consumer appears.

6. **Calendar-backed edits are overrides until write-back lands.** Editing a calendar-backed event's title, description, host, guest speaker or location (on the event page or the prickle page) saves a decision in `unmatched_calendar_events` that the sync applies on top of the calendar; the Google item itself is not changed, and the times (start, end) cannot be edited at all. Write-back (item 2) turns these into real edits to the calendar item and makes the times editable.

**Why deferred:** the first PR only had to remove the duplicated fields and the two-sources-of-truth editing before launch. **Where to start:** `lib/calendar-events.ts`, `lib/data/events.ts`, `docs/CALENDAR_EVENTS.md`.

### Events for one cohort only (live course lessons) _(Needs Scheduling)_
The first group through a course (the Ready Writer) has its lessons run live, as calendar items titled "<course> | Lesson N: ...". They are events, but only for the people in the course. Every event today is visible to every member, and there is no audience narrower than "members" (`guests_allowed` and `announced_publicly` only widen it), so tagging such an item `#event` would show it to the whole community. Until this exists the items stay in the unmatched queue (`/admin/hygiene/unmatched-events`), left pending rather than ignored, and the cohort is told about the sessions where it already meets.

**Why deferred:** it is a feature, not a flag: who may see an event has to be enforced everywhere events are read, and launch was days away. **Where to start:** a nullable cohort on `community_events` (`program_cohorts` has the window and `program_id`; `member_program_enrollments` says who is in it), so visibility is "an event with no cohort is for everyone, one with a cohort is for its enrolled members and admins". Enforce it in the `community_events` RLS select policy first, then check every reader that bypasses RLS with the service role: the member Events pages and the past list (`lib/events-agenda.ts`, `app/api/events/past-prickles`), search (`lib/search/universal.ts`), the calendar feed (`lib/data/calendar-feed.ts`), notifications, and the admin forms (a cohort picker beside the audience fields, `components/EventAudienceFields.tsx`). Decide how a lesson item gets its cohort: by an `#event cohort=<slug>` style tag in the calendar description or a prickle type tied to a program (`lib/calendar-events.ts`, `hasEventTag`). The related idea of an event pointing at a program is item 4 under "Managing events in the Hub". The prickle on such an event is still a normal calendar prickle of the Event type, so it stays out of the session lists and prickle search (they skip the Event type) and shows in the admin calendar. Not checked: whether a member outside the cohort can still open it by its prickle id (`/prickles/<id>`, and the RLS select policy on `prickles`); verify that before relying on the event's own visibility.

### Daily coaching videos: member submissions in the Hub _(Needs Scheduling)_
Members who want to teach a daily coaching video fill out an external **coaching video sign-up form**, and a separate shared list of **proposed coaching videos** gives them ideas. The Hub has courses and lessons (`docs/COURSES.md`) but no way for a member to propose, claim or schedule a video, and no list of proposals. The Kajabi lesson "Submit a Daily Coaching Video" stays in Kajabi until this exists.

**Why deferred:** it needs a decision on who reviews and schedules submissions (admins, a host team) and where the videos land (a course, the calendar as an Educational Prickle). **Where to start:** a `coaching_video_proposals` table (topic, who, status proposed/claimed/scheduled/done, `deleted_at`) with member-facing submit and browse pages, an admin queue (`/admin/work-queue` fits), and a link to the scheduled calendar event. Then write the help article from the real screens (a demo scene, `help/`, `HELP_ORDER` in `lib/help.ts`).

### Suggest a webinar or coaching topic: intake in the Hub _(Needs Scheduling)_
The Kajabi lesson "Suggesting a Webinar or Coaching Topic" is an empty draft: there is no documented way for a member to suggest a topic, and the Hub has none either. Today suggestions arrive through chat or email and live in people's heads.

**Why deferred:** nothing to document yet, and it overlaps the coaching video proposals above (a suggested topic is a proposal nobody has claimed). **Where to start:** build it as the same proposals table with a "suggested, no presenter" status rather than a second feature, add a member-facing "Suggest a topic" form, and let members vote or +1 so admins can see demand (`lib/analytics/events.ts` for the usage events). Then add the help article.

### Reproducible demo and help docs _(Needs Scheduling)_
A fictional demo community plus Playwright scenes that capture screenshots and clips, for the RayhausCapital newsletter now and member help articles later. Design in `docs/DEMO_AND_HELP.md`.

**Resolved:** the separate demo stack (`pnpm demo:stack`), a seed through the real calendar processing (`pnpm demo:seed`), sign-in as a persona through the real auth flow, and one scene ("How to join a prickle") running across four sizes in light and dark (`pnpm demo:capture`).

**Resolved:** the `/help` route (index, article pages, signed-in image route, Help in the sidebar), `help/` out of the docs-only allowlist, the private `help-images` bucket and `pnpm demo:publish`, and five articles: join a prickle, plan your month, become a host, start a PUP, run a prickle (index order is `HELP_ORDER` in `lib/help.ts`; tests check every link and screenshot resolves to a real article and scene step).

**Resolved:** screenshots are captured by the scheduled `Help screenshots` workflow (not per merge: it added about 8 minutes to every main run), published as sets named by commit, and each deploy shows the newest set captured at an ancestor of its commit; the workflow redeploys the production commit after publishing so production picks the set up (see `docs/DEMO_AND_HELP.md`).

**Resolved (mockups):** Slack, email and browser push drawn for every notification kind from the real message code (`demo/mockups/`, `demo/scenes/notification-mockups.spec.ts`); the Slack frame uses `slack-blocks-to-jsx`.

**Resolved (demo realism):** the seed adds ten non-signing-in members and a deterministic Zoom attendance history (`demo/attendance.ts`) that the real `/api/process/attendance` turns into attendance, so the schedule shows typical crowds and hosts have stats; the feedback bubble and environment label are hidden in captures.

**Still open:** a failed scheduled capture only emails (post it to `#hub-alerts` like other failures once CI has a way to); no PR gate or PR preview of the images any more (a scene broken by a PR is found the next morning; a label-triggered capture on PRs would bring the preview back); `.github/workflows/help-previews-cleanup.yml` and the `help-previews` branch can be deleted once no open PR has a `pr-<n>/` folder there; if production moves on between the capture and the redeploy, the redeploy is skipped and the new set waits for the next deploy that follows it or the next night's run; a visual diff against the previous set; the same capture for dark and phone images; articles in the search palette; light/dark and phone variants of article images; the Kajabi "Hedgie Help!" topics that are processes outside the Hub, deliberately left in Kajabi until the Hub has the feature (see "Kajabi help topics left in Kajabi" below); public pages for members who can't sign in; more scenes and personas; members are written directly, not derived from a Kajabi import; WebKit for the phone project; a baseline for visual comparison; running scenes in CI. Also: no generated database types, so seed rows are untyped (`supabase gen types typescript --local`); the Kajabi "Hedgie Help!" lessons describe the pre-Hub Slack/Zoom/spreadsheet workflow and need rewriting against the app.

### Page checks: more screens, and what the checks can't see
The demo scenes' page checks (`demo/checks.ts`, docs/DEMO_AND_HELP.md) run axe, overflow, edge, covered-control and console checks on every screenshot at all sizes and both themes, after scrolling every area. **Resolved:** a phone could not see or scroll Thursday to Saturday on any week calendar (reported from a real phone; see docs/DEMO_AND_HELP.md, "Page checks"), the `calendar-views` scene now scrolls every day into view at every size, and the 245 existing findings are fixed and `demo/baseline.json` is empty, so any finding now fails a run. The fixes were a one-step shift of the secondary text colours (light `text-slate-500` to `600`, `400` to `500`; dark `dark:text-slate-500` to `400`; a dark colour added to class strings that had none), names for the prickle type filters, `inert` on the closed mobile drawers, a keyboard-focusable named region for the host calendar, and the search button's name now containing its visible text (the `⌘K` hint is drawn by CSS).

### Courses in the demo: the player _(Needs Scheduling)_
The `courses` scene (`demo/scenes/courses.spec.ts`, seeded by `demo/courses-seed.ts`) puts the member course pages through the page checks at every size and theme: the list, an outline with progress, a lesson with text and a download, the "video is still being prepared" and "couldn't be prepared" states, a module page, an ended course, a course that opens later, and marking a lesson complete and taking it back. **Still open:** (1) the player itself: no demo video is ready, because playback needs Mux signing keys and a stream, so the Video.js controls (labels, contrast, focus, the speed and captions menus) are not checked. **Where to start:** a generated signing key pair in `demo/.env.demo` (`MUX_SIGNING_KEY_ID`/`MUX_SIGNING_KEY_PRIVATE`; tokens are signed locally, no network) and `page.route` for `stream.mux.com` and `image.mux.com` to serve a tiny local clip and poster, then a `ready` video in `demo/courses-seed.ts`. (2) **Resolved:** staff previews (a draft, a "coming soon" lesson, the preview banner) are in the `courses` scene now that the demo admin has a member record. `StaffProgressTools` only shows on a lesson with a video, so it waits on (1). (3) The lesson page with the section list beside the video (wide screens) only shows when a video plays, so it waits on (1).

**Still open:**
- The checks only see the screens the scenes visit (about a dozen), so the same classes elsewhere (admin pages, chat, courses, events) are fixed by the sweep but unverified. Each new scene adds coverage; a scene per major page would close it.
- Automated checks find about a third of accessibility problems. A keyboard-only walkthrough of the main flows and a screen reader pass (VoiceOver on iPhone and Mac) are not automated and have not been done.

### Kajabi help topics left in Kajabi
The Kajabi "Hedgie Help!" module had ten lessons. Six are now Hub help articles (join a prickle, plan your month, become a host, start a PUP, run a prickle, which also covers "if you can't host"). Four stay in Kajabi on purpose, because each describes a process that happens outside the Hub, with no screen to document or screenshot:
- **How to get a BFF (Best Feedback Friend)** and **What to expect in the BFF Program?** (a draft that only points to an attached document): enrollment and matching run through an external form. See "Best Feedback Friend (BFF) program: enrollment and matching in the Hub".
- **Submit a Daily Coaching Video**: an external sign-up form plus a shared list of proposals. See "Daily coaching videos: member submissions in the Hub".
- **Suggesting a Webinar or Coaching Topic** (an empty draft): no intake exists. See "Suggest a webinar or coaching topic: intake in the Hub".

**Why deferred:** a help article would duplicate the Kajabi lessons, and the form links sit in a members-only lesson while this repo is public, so they can't go in an article. **When to pick up:** when the Hub gets a BFF matching flow or a topic and video submission form (then document the real screens), or if the Kajabi lessons are retired. If form links ever need to appear in articles, declare them as env vars in `env-vars.config.ts` and render them through a placeholder, never as literals. Where to start: `help/`, `lib/help.ts` (`HELP_ORDER`), and the scenes in `demo/scenes/`.

### Launch overview video for existing members _(Partly done)_
**Resolved:** a 30-second and a 2.5-minute member overview (commitments and calendar sync, what it looks like in Google Calendar, attendance history, streaks, writing and logging progress, chat with posting, members, notifications, Hedgie Help), with a women-writers cast in a bookstagram voice are recorded by `pnpm demo:video` (`demo/video/`, see `docs/DEMO_AND_HELP.md`, "Overview videos"): captions drawn in the page, a visible cursor, title cards, narrated (a local neural voice), WebM and MP4 at 1440x810 (the MP4 needs a system ffmpeg).

**Still open:** the owner's review of the script and tone (`docs/OVERVIEW_VIDEO_SCRIPT.md`); a person's reading (planned: Ania reads it from `pnpm demo:reading:sheet`'s PDF; the pipeline is built and tested with a stand-in recording, but no real take exists yet); background music; the Google Calendar stills are made by hand from a real account (a reproducible version needs a public feed URL Google can reach, or a Google test account); phone and dark-mode cuts (the director takes a colour scheme, but the scenes are recorded light at desktop size only); a "become a host" cut from the host persona; and segments the demo can't show yet because the seed has nothing for them (Bookshelf and the Wheel of Wonder are empty: the wheel needs members online, the shelf needs a published book with a cover image). **Where to start:** `demo/video/overview.spec.ts`.

### Check-in answer scale on Slack's phone app: does the layout bias answers? _(Needs Scheduling)_
The prickle check-in DM (`lib/prickle-checkin-dms.ts`) asks "how do you feel" and "how's your energy" as rows of five buttons (Very bad ... Very good, Very low ... Very high) in a Slack `actions` block. In the demo's phone mockup (`demo/mockups/frames.tsx`, an approximation, not Slack's own layout) the last button wraps onto a second line on its own. If Slack's iPhone app really does that, the scale is no longer one row of five equal options: the isolated option stands out, the order and spacing cues are lost, and rating scales are known to shift with layout (position, spacing and grouping change which options people pick). Check-in answers feed the member's own history and the admin views, so a skew from the layout, not the feeling, would be quiet and hard to spot.

**What's unknown:** how Slack's iPhone and Android apps lay out five buttons in one `actions` block (wrap, stack, scroll sideways). **Why deferred:** needs a real-device look first, then a decision on the message design. **Where to start:** (1) send the check-in to a phone from Admin → Test Notifications and screenshot it on iPhone and Android, replacing the approximate frame's guess; (2) if it wraps or stacks, try a form that stays one row of equal options, such as short labels or numbers (1 to 5) or one emoji face per option, keeping the same order and the endpoints' text in the message, or a single `static_select` for each scale; (3) compare answer distributions before and after (`prickle_checkins`, the feelings and energy keys in `lib/prickle-checkins.ts`) and watch `lib/analytics/events.ts` for how often each is answered. Related: the same wrapping applies to any future message that puts several buttons in one row.

### Chat composer: byte-level upload progress
Dropping files on the profile panel now attaches them to the conversation composer (the composer is given drop target ids explicitly: `dropTargetIds` on `components/chat/Composer.tsx`, ids set in `app/(member)/chat/[id]/page.tsx`). **Resolved:** drop on the profile panel, explicit drop targets, sent-image lightbox, `chat_delete_file` pgTAP test, and a progress bar while sending, now in bytes across all files with a ring on each thumbnail (XHR upload to the signed URL, `lib/chat/upload-progress.ts`). **Resolved:** a Cancel button while uploading aborts the transfers (nothing is sent, files stay attached, the box is editable again; staged leftovers go to the staging cleanup). Files upload in parallel (up to `CHAT_UPLOAD_CONCURRENCY` at a time, `lib/chat/upload-pool.ts`); one failure aborts the rest and keeps the files attached, and staged leftovers are swept by the staging cleanup.

### Move Inline SVGs to the Icon Library
`lucide-react` is installed (named imports, tree-shaken) and Settings' "Use current location" button uses its `Locate` icon. **Still open:** the other hand-pasted inline SVGs in components; move each to lucide as it's touched (decorative icons keep `aria-hidden="true"`, color via `currentColor`).

### Past Events Page: what is left _(Needs Scheduling)_
**Resolved:** `/events/past` lists past events and the past sessions of listed prickle types a month at a time, linked from the Events page, with the neighboring months fetched ahead. **Still open:** it loads every event at once (fine at hundreds; fetch per month like the sessions if the table grows into the thousands), a month's sessions are capped at 200 (`EVENT_PRICKLE_LIMIT`), and the months offered start at the first event (sessions older than that are not found; the calendar import only reaches back 90 days anyway). **Start:** `app/(member)/events/past/`, `lib/event-prickles.ts` (`fetchPastEventPrickles`).
### Event Times on the Event Page _(Needs Scheduling)_
The Events list now shows a time of day for events that have `start_time`/`end_time` (calendar-linked events and prickles; all-day and dates-only events show none). The event detail page (`app/(member)/events/[slug]`) still shows dates only, and an event made by hand in admin has no time field, so it never shows one. **Start:** show `formatTimeSpan` (`lib/events-agenda.ts`) under the date on the detail page, and let `EventDetailsCard` in admin set the start and end time.

### Event Resources and Downloads _(Needs Scheduling)_
`events` only has text fields (`focus`, `description`, `agenda`, `results`) and a photo gallery (`event_photos`). The member event page (`app/(member)/events/[slug]/EventDetailClient.tsx`) shows the text with `whitespace-pre-wrap`, so there is no place for the files a retreat hands out (worksheets, slides, workbooks, recordings), and a URL in a description is plain text, not a link.

**Today (interim):** the virtual retreats were filled in from their calendar invites (description, itinerary, focus), and the shared Google Drive files for the retreats that had them are pasted into the description under "Materials shared with attendees:" as plain URLs. Not clickable, untitled, and nobody checked who each Drive file is shared with; the event page is open to every signed-in member.

**Why deferred:** the retreat details were worth getting in now, and resources need a few decisions first (where files live, who can open them).

**Shape to design:**
- An `event_resources` table (event, title, kind such as file or link, URL or storage path, sort order, `deleted_at` soft delete), admin-managed like `event_photos` (editor on `app/(admin)/admin/events/[id]/EventDetailClient.tsx`), shown on the event page as titled, clickable items.
- Files we host go in a private storage bucket with signed URLs (as for course videos), so access follows membership; external Drive files stay links, and the admin UI should say Drive sharing is separate from Hub access.
- Decide whether resources are for everyone or only attendees (`event_attendees` already says who attended).
- Then move the pasted Drive URLs out of the descriptions into resources and delete the "Materials shared with attendees" paragraphs.
- Tests (route, component, RLS) and an analytics event for opens or downloads (`docs/ANALYTICS.md`).

### Site-wide "Return To" Handling (Needs Design)
**Resolved:** sign-in return. The proxy stores the requested page in the `hub_next` cookie before redirecting to `/login`, and the email callback, Slack button and Slack code read it back via `takeNextPath()` (`lib/next-path-cookie.ts`, validated by `safeNextPath()` in `lib/safe-next.ts`).

**Still open:**
- **Session expiry or idle timeout mid-form.** Whatever detects a 401 or expired session in the browser should send the member to `/login` with the current location stored (not wait for the next full page load to hit the proxy), and ideally keep their unsaved input.
- **"← Back to …" links** are hardcoded per page (e.g. `app/(member)/prickles/[id]/page.tsx` picks "Back to Calendar" vs "Back to My Prickles") and ignore where the visitor came from. Carry the origin (a `?from=` param or history state) and derive the label from a route registry ("Back to Alex's profile"); keep today's default as the fallback.
- **Sudo** keeps its own `sudo_return_to` (Referer, `lib/sudo-redirect.ts`). Fold it into one module (`lib/return-to.ts`: `storeReturnTo`, `takeReturnTo`, `peekReturnTo`, named slots, one same-origin-path validator, GET navigations only) with a shared open-redirect test suite.

### Member Location History, and Video Viewing Attribution _(Built, with follow-ups)_
**Why:** Kajabi's per-viewer video stats show where each view came from ("Muncie, Indiana, US") and the device. We want that, and more generally geographic insight into the membership. A member's location changes over time (prickles ask "Where are you writing from today?"), so it belongs to a *period*, not to the member row.

- **Built (2026-10-20): the raw IP and the derived place are stored on `access_events`**, the general per-member access log, not on any one feature: `ip_address`, `country`, `region`, `city` (migration `20261128000100`), written by the proxy and the page-view tracker through `lib/request-location.ts` (validated and capped, so a junk header becomes null, never a lost event). Admin-read only, erased with the account. A time-based join, `access_locations_at(user ids, times)`, gives anything that happened at a time (a video view today) the member's latest located event before it, within a day. Before this the only geo use was `x-vercel-ip-country` for the consent banner (`lib/gdpr-countries.ts`).
- **Vercel's geo headers** are added to every request on a deployed Vercel project (absent locally, so test with a stubbed header): `x-vercel-ip-country` (ISO 3166-1 alpha-2), `x-vercel-ip-country-region` (ISO 3166-2 region code), `x-vercel-ip-city` (city name, **URL-encoded** per RFC 3986, so decode it), `x-vercel-ip-latitude`, `x-vercel-ip-longitude`, `x-vercel-ip-postal-code`, and `x-vercel-ip-timezone`. Vercel's `geolocation(request)` helper (`@vercel/functions`) returns them parsed. They are coarse (city level, sometimes wrong, VPNs and mobile carriers skew them) and describe where the *connection* is, not where someone writes from.
- **Why the access log, not a history table:** each row already has the auth session and user agent and is the "where was this member at time T" source, and the latest-event-before-T join is the date-range join this entry first proposed with periods. A compact per-place "periods" view or table (collapsing consecutive events at one IP) can be derived from it later if the log gets large.
- **Still open:** whether to also join the self-reported "where are you writing from today?" answer as a second, more honest source beside the IP-derived one; showing a member's place history on their admin page (the access history page doesn't show it yet); and retention for raw IPs (nothing prunes `access_events` today).
- **Decision recorded:** raw IP and the derived place are both kept for now (the owner's call), described to members on the flagged `/privacy` page ("Where you connect from"). It is first-party and not consent-gated; see `docs/ANALYTICS.md`, "Course viewing data", for the EU/UK note.
- **Built, for the per-viewer list:** the played-session record is a `kind = 'viewed'` marker row in `video_watch_segments` (one table, written by the player when it appears, with the user agent), not a consent-gated analytics event: members who decline the banner would otherwise vanish from play rate's denominator. See `docs/ANALYTICS.md`, "Course viewing data", for the decision and the EU/UK risk it carries.
- **Notice:** the flagged `/privacy` page now says how course videos are watched and where visits come from. Still to consider: a Settings switch to opt out of course viewing statistics (the playhead for resume would stay).

### Back up the original course videos before leaving Kajabi _(Needs Scheduling)_
The Hub never stores the course videos itself. `lib/courses/media.ts` gives Mux a link to the file in Kajabi and Mux fetches it, so **once the Kajabi subscription ends, the original files may exist nowhere but Mux** (production, checked 2026-10-30: 10 `videos` rows, all with a Mux asset; our storage holds only lesson PDFs in `course-files` and images in the media library). I have not verified what Mux keeps of an uploaded original: by default it keeps the encoded renditions, and the original is only downloadable with "master access" (or MP4 renditions) turned on for the asset. Before cancelling Kajabi: (1) decide where the originals should live (a private bucket, or Descript's exports, which Ania already has); (2) for every video, either keep the Kajabi source file (Video actions, Download video in Kajabi's lesson editor; the link `lib/courses/media.ts` records expires after 7 days) or turn on Mux master access and download it; (3) check the count of originals against `videos`; (4) note it in `docs/COURSES.md`. Wistia-hosted copies behind Kajabi go away with the subscription too.

### Launch day: check a shared lesson link as a signed-out visitor _(Low priority)_
The public lesson preview (`docs/COURSES.md`, "Public lesson preview") is only covered by unit and database tests, and it can't show anything in production until the `courses` flag is on **for everyone** and at least one lesson is open (checked 2026-10-31: 53 lessons in The Ready Writer, 8 coming soon, 45 hidden, none open). Once launched: (1) open an open lesson's address in a private window and confirm the card (course, title, excerpt, thumbnail, "Sign in to watch"), and that signing in lands on the lesson; (2) paste it into Slack and a message to see the real unfurl (Open Graph large image); (3) in the builder, "Copy link with thumbnail" on that lesson and paste into an email or doc; (4) open a coming-soon or draft lesson's address signed out and confirm it still goes to the login page with no title or image. If the unfurl shows no picture, check that the thumbnail's address (`/api/courses/image/lesson/<id>`) loads signed out.

### Course editor: lock a whole course _(Needs Scheduling)_
A module or lesson can be Locked (members see it as coming soon), but a whole course can only be made available or not (`courses.is_draft`, Publish / Unpublish). A course-wide Lock (everything visible but not open, for example before a cohort starts) was dropped when course availability stayed `is_draft` and the two were not combined. **Where to start:** decide whether it is a third course state or just "set the top-level modules to Locked", and where it shows (the course card, `lib/courses/member.ts`); a course-level setting would also sit above the item rule in `course_item_state` and `planFullTree`, which today treat the top as always open.

### Course editor: Schedule and Drip statuses _(Needs Scheduling)_
Kajabi's status menu has five choices; the Hub offers three (Draft, Publish, Lock; plus following what is above). **Schedule** needs a date (and an unlock job or a read-time check, since members' access is by `state`, which row-level security reads), and **Drip** needs a delay from the purchase date (per member, so it can't be a single stored `state` at all: it is computed per member from `course_access.starts_at`). Today `scheduled` and `drip` rows are kept as imported: drip reads as coming soon (as in `visibilityFromPublishing`), scheduled as hidden (an unknown value), and `set_course_item_status` refuses both (`unsupported_status`). **Where to start:** a `scheduled_at` on `course_modules`/`course_lessons`, a rule for what a scheduled item is before its date (coming soon is the likely one, matching Kajabi), and either a nightly recompute or a view; for drip, a delay column and a per-member check where lessons are opened (`lib/courses/member.ts`). Check what the Kajabi import gives for scheduled and drip items first (`bronze.kajabi_course_*.publishing_option` is only ever draft, published or locked in production today, checked 2026-10-31).

### Course editor: outline follow-ups _(Needs Scheduling)_
Left out of the first outline editor (`docs/COURSES.md`, "Editing model") on purpose; each is small on its own.
- **Move across lists.** Dragging works within one list (a module's lessons, a course's modules, a module's submodules). Moving a lesson into another module, or a submodule into another module, is not built: it needs a database function like `reorder_course_children` that also changes `module_id` / `parent_id` (keeping the same-course and one-level rules, which the database already enforces) and renumbers both lists, then drop targets on module headers.
- **Duplicating a lesson doesn't copy its downloads.** The files live in the private `course-files` bucket under the lesson's id (`course_lesson_files`); a copy needs the storage objects copied too, so a lesson doesn't share a file with its copy (deleting one would remove the other's).
- **Lessons without a module.** The database allows a lesson in no module (imported courses have some), but the editor only adds lessons inside a module.
- ~~**Reorders aren't in the audit log.**~~ **Resolved (2026-10-31):** one entry per reorder, with the order before and after (`docs/ACTIVITY_AND_AUDIT_LOG.md`).
- **Deleting a lesson members have progress in is refused** ("hide it instead"), which needs the status menu (next PR) to be a real way out.

### Course builder: the Video actions that are still disabled _(Needs Scheduling)_
The lesson builder's Video actions menu (`app/(admin)/admin/courses/[id]/lessons/[lessonId]/VideoActions.tsx`) copies Kajabi's. **Working now:** Video stats (links to the lesson's watch stats) and Copy timestamp URL (the lesson's member address with `?t=<seconds>`, which the member lesson page honours, `startSeconds` in `lib/courses/watch.ts`). **Disabled, and why:**
- **Closed captions** (Kajabi opens a "Transcription playground": Transcriptions, Translations and Dubbing tabs, upload or generate a transcript). It edits, and no captions manager exists yet. Where to start: the `video_text_tracks` table (`docs/COURSES.md`, "Captions and other per-video assets"), the planned small admin Videos screen for SRT/VTT uploads, and attaching tracks to the Mux asset. A read-only view of existing tracks could ship first.
- **Download video.** Mux serves no downloadable copy unless MP4 static renditions are turned on for the asset (a Mux setting with storage cost), and the Kajabi source link expires after 7 days. Decide whether the cost is acceptable; then an admin-only route that redirects to a signed `highest.mp4`. Check `docs/MUX_CONFIG.md` first.
- ~~**Copy link with thumbnail.**~~ **Resolved:** a lesson's thumbnail and a small preview page are public when the lesson is open to members (see "Public lesson preview" in `docs/COURSES.md`), and the menu item copies the lesson address as a clickable picture.
- **Remove video** is an edit, so it waits for saving.

### Course Hero Image _(Needs Scheduling)_
The course page (`app/(member)/courses/[slug]/page.tsx`) has a plain plum hero band, while Kajabi shows a banner photo behind the title (e.g. a notebook for Murky Middle) that is **not** the course thumbnail (the puzzle). Kajabi's course API only returns `thumbnail_url`, so the hero image can't be imported.

- Add `courses.hero_image_url` and let an admin set it (upload to storage, or paste a URL) on the admin course page.
- Render it as the hero backdrop under a dark overlay (`bg-black/60`) so the white title stays readable; with none set, keep the plum band.
- Until then, the sidebar shows the thumbnail, full width at the top of the card.

**Resolved (course images migration):** the images the public API does give us (course cover `thumbnail_url`, module `poster_image_url`, lesson thumbnails) are now copied into the private `course-images` bucket and served by `/api/courses/image/<kind>/<id>` instead of hotlinked (`lib/courses/images.ts`, `docs/COURSES.md` step D). The course page's sidebar thumbnail also works now (the loader never selected it).

**Resolved (hero pipeline, no source yet):** a course's hero is stored on `bronze.kajabi_courses.hero_image_url` (the API import never writes that column), processing copies it to `courses.hero_url`, `copyCourseImages` stores our copy (`hero_path`, `hero_source`, `course-images/COURSE/hero.EXT`, served as `/api/courses/image/hero/COURSE_ID`), and the course page draws it behind the title under a dark overlay (the plain plum band without one). Same idempotency and cleanup as the other images. `lib/kajabi/course-hero.ts` finds a hero-like URL in JSON and saves it.

**Still open:** nothing fills `hero_image_url` yet. The Kajabi API has no hero field, and a real run showed the admin product page (`/admin/products/ID`) does not carry it either: it loads only the categories and posts, and the one course-sized image on it is the cover. The banner is on the member-facing course page (`/products/SLUG` on the public site) as a CSS background image of the hero section, and some courses have none (The Ready Writer shows the plain band; Murky Middle has a photo). So `courses:content --hero` (opt-in, off by default) is a dead end as written. When a course that has a hero migrates (Murky Middle is not on the launch list), either read the background image of the hero section from the member page in the same logged-in browser (needs the site URL as config and the member login, and the course's Kajabi URL slug), or the admin upload/paste option below. (2) The admin upload/paste option for a hero (one image per course, set once). (3) Module posters are copied but no page shows them yet (module rows use their first lesson's thumbnail).

### Remove legacy `?tab=` redirects _(Cleanup, review on or after 2027-01-03)_
Tabs became URL paths on 2026-10-03 (`/settings/notifications`, `/my-prickles/all`; see `lib/tab-routes.ts` and CLAUDE.md "Tabbed Pages"). Old `?tab=` links still work because each base page calls `redirectLegacyTabParam`. Nothing is stored; it's four one-line calls plus the helper:
- `app/(member)/settings/page.tsx`, `app/(member)/my-prickles/page.tsx` (also rewrites `?tab=commitments&slot=X` to `/my-prickles/all?commit=X`), `app/(member)/projects/page.tsx`, `app/(admin)/admin/members/[id]/page.tsx`
- `redirectLegacyTabParam` in `lib/tab-routes.ts`, its tests in `tests/lib/tab-routes.test.ts`, and the legacy cases in the page tests (`settings-routes`, `my-prickles-tabs`, `my-writing-page`)

Old links come from Slack DMs (the check-in/check-out "Notification settings" link, sent from 2026-10-03 until this change deploys; Slack keeps them forever), calendar feed descriptions (refreshed by calendar apps within a day), and bookmarks or links pasted into Slack, emails and docs.

**When:** each redirect logs `[legacy-tab-redirect]` with the page and tab. After 2027-01-03, search the Vercel logs for it. If none (or only a stray few) in the last 30 days, delete the calls, the helper and their tests, and drop the "old `?tab=` links" bullet from CLAUDE.md. A `?tab=` URL then just opens the page's first tab, which is a fine fallback. If they're still being hit, look at which page and tab and check again in another quarter.

### Drag-and-Drop Table Column Reordering (Not Persisted)
Every admin table (Hedgieversaries, Members, etc.) has a fixed column order set in code — on mobile, whichever columns come first are the only ones visible without scrolling, so getting the "right" default order matters but can't cover every viewer's priorities. Letting users drag-and-drop reorder columns in the standard table widget (session-only, not persisted per-user) would let each viewer put what they care about first without a code change per table.

**Scope:** this is a shared table component enhancement (wherever `SortableTh`/the standard table widget lives), not a one-off per page — worth building once and getting for free everywhere.

### Navigation & Layout
- **User settings - additional preferences**
  - Preferred theme (dark/light/device default)
  - Working location for global time analysis
  - Further refine navigation hierarchy and grouping

### Dashboard Improvements

**Needed Fixes:**
- Top Attendees list should link to each member's profile page
- At-Risk Members list should link to each member's profile page

**Potential Additions:**

1. **Recent Activity Feed**
   - Last 10-20 activities across all members
   - Types: New members, prickle attendance, hiatus starts/ends
   - Real-time or near-real-time updates

2. **Upcoming Prickles This Week**
   - Calendar preview of this week's scheduled prickles
   - Show host, type, time, expected attendance (based on historical avg)
   - Click to view prickle details or edit

3. **Host Leaderboard / Host Stats**
   - Top hosts by number of prickles hosted (last 30 days)
   - Host attendance/punctuality stats
   - Identify hosts who need support
   - **Current hosts view**: for each active host, show hosting stats:
     - Total prickles hosted, total missed, total late
     - Total participants and total unique participants
     - Total duration hosted
     - First host date and most recent host date
     - Hosting streaks: consecutive weeks in a row, consecutive months in a row
   - **All-time hosts view**: everyone who has ever hosted, with same stats above

4. **Attendance Trends Charts**
   - Line chart: Average attendance over time (30/60/90 days)
   - Bar chart: Attendance by prickle type
   - Heatmap: Popular prickle times (day/hour)

5. **Alerts & Notifications Panel**
   - Host no-shows this week (scheduled but didn't attend)
   - Members who just became at-risk
   - Data processing errors or warnings
   - Unmatched Zoom attendees count

6. **Member Lifecycle Summary**
   - New members this month
   - Members ending hiatus soon
   - Churned members (went inactive this month)

### Admin Features
- Manually create/edit members
- Manually create/edit Prickles

### CRM & Outreach Automation Roadmap (Needs Scoping — Multi-Phase)
`/admin/outreach` (hot/warm/cold status, the daily 25-lead queue, `outreach_touches` log) is the first slice of a much bigger planned system: a built-in CRM with a unified inbox, response-driven outreach, lead scoring, and eventually an AI prospecting agent. Stated 2026-09-09 as the direction to build toward — not scoped or started beyond Outreach itself. Phases below are roughly the order they'd need to happen (later phases depend on earlier ones), not a commitment to build all of them.

**Phase 1 — Centralized activity log (CRM backbone). In progress.** `member_activities` already existed (written by Slack import + writing-progress) and is being extended to also mirror prickle attendance, outreach touches, and Hedgie Hub logins — see `docs/ACTIVITY_AND_AUDIT_LOG.md` for the schema (`actor_kind`/`actor_user_id` for who acted, `data` for the event's actual content) and the separate `audit_log` (field-level record-change history, distinct from this activity log — see that doc for why they're two tables). `audit_log`, its triggers and the admin `/admin/activity` page (Audit / Everything filter over both tables plus page-visit sessions) are built. The member page has an Activity Log tab over the same feed. The clock icon (`RecordHistoryButton`, top-right of each page) is on the member, event, program, badge type and prickle type pages and the Segments, Users, Overrides and Hosts lists. Every audited resource now has a history button. Remaining work is listed in the follow-ups below.

Phase 1 follow-ups (activity/audit log):
- [x] Log sudo start and stop as their own events (done: `logSudoEvent` in `app/actions/sudo.ts`) (who started viewing as whom, when, and for how long): `startSudo`/`exitSudo` in `app/actions/sudo.ts` write a `member_activities` row (`actor_kind = 'staff'`, `acting_as_member_id` set), so the activity log shows the boundaries of a sudo session, not just the visits inside it.
- [x] `MultiMemberSearch` and `MultiSelectSearch` are thin wrappers over `components/MultiEntitySearch.tsx`, the multi-select counterpart of `EntitySearch`.
- [x] `admin/data-health/missing-hosts` writes through server actions (`actions.ts`); its reads still use the browser client.
- [ ] Email sent/opened/clicked events in `member_activities`. Email is now a notification channel (`lib/channels/`, Resend), so it is a source; nothing is logged as activity yet.
- [ ] `p_changed_by` argument on the audit functions, for the first service-role write made on behalf of a user. None exists yet, so add it with that first write; see `docs/ACTIVITY_AND_AUDIT_LOG.md`.
- [ ] Privacy view: log break-glass grants and reads of restricted Slack content. Today it covers only a channel being restricted or the restriction lifted (`restricted_slack_channel`); add the new entity types to `PRIVACY_ENTITY_TYPES` in `lib/activity-feed.ts`.
- [ ] Slack channel names on old activity rows are a snapshot from insert time, so a later channel rename isn't applied to them. Decide whether to backfill on rename or resolve the name at read time.

**Phase 2 — Inbox.** A Beeper Desktop-inspired unified inbox inside Hedgie Hub showing messages across connected accounts, with filter views: All / Unread / Drafts / Unanswered / Archived / Requests / Low Priority. Requires real per-channel integrations to pull messages in — Instagram DMs (Graph API, needs a Business/Creator account linked to a Facebook Page, and Meta's app review for `instagram_manage_messages` has real lead time), email (provider-dependent — Gmail API vs. a shared inbox forwarding setup), Slack (already have API access, just needs message-fetch + a read UI). Likely built incrementally per channel rather than all at once.

**Phase 3 — Outreach ↔ Inbox integration.** Once Phase 2 exists, Outreach should surface a "needs response" view — leads who replied to a cold outreach touch, as a filtered subset of Inbox scoped to outreach recipients. This is where a reply stops being invisible in personal Instagram/email and becomes an actionable queue item, closing the loop that today's one-way `outreach_touches` log doesn't.

**Phase 4 — Lead scoring.** Augment Ania's manual hot/warm/cold with a computed score, using Phase 1's activity log as the input (engagement signals, response patterns, etc.) once there's enough activity data to make a score meaningful.

**Phase 5 — AI prospecting & messaging agent.** An agent that (a) finds people not yet on the lead list by searching online (Instagram and beyond), (b) reads their profile/page for talking points and fit signals, (c) drafts an initial outreach message, and (d) over time learns Ania's voice and optimizes messaging for response rate and conversion — likely needs its own feedback loop off Phase 1's activity log and Phase 4's scoring. Longer-term: SMS and voice-call outreach (Vapi mentioned as a candidate for voice).

**Open questions (apply across phases):**
- Single shared Instagram/email account for outreach, or per-staff-member accounts? Affects OAuth/connection architecture for Phase 2.
- Data model for Phase 1 — settled on extending `member_activities` (one row per event) rather than a new table; see `docs/ACTIVITY_AND_AUDIT_LOG.md`.
- How much of Phase 5's "AI agent" runs autonomously vs. drafts-for-review — cold outreach to strangers sourced by an AI carries real brand/trust risk if it goes out unreviewed.
- **ORM evaluation** (decoupled from the above — came up while designing `audit_log`'s trigger-based change tracking, which needs no ORM and works regardless of this decision): this codebase has no ORM/model layer, just direct `supabase-js` calls across routes. Worth evaluating on its own merits (type safety, query ergonomics) at some point, but not framed as something the audit log or any of the above phases are blocked on or temporary until.

**Phase 5 MVP started (see `docs/PROSPECTING.md`).** Built: `outreach_prospects` table and `ProspectRepository`, paste-import with a deterministic rules-based fit score (`lib/prospecting/`), a review page at `/admin/outreach/prospects`, and a local `pnpm prospects:assess` that asks Claude (via the logged-in Claude Code CLI) for an advisory read and a draft opener. **Still open:** (1) the rules in `lib/prospecting/rules.ts` are a first guess until Ania answers the questions in `docs/PROSPECTING.md`; (2) discovery: Bluesky runs from a button; still open: a nightly run (pg_cron + heartbeat), the Instagram source (needs Meta app review, see `docs/PROSPECTING.md`) and other platforms; logged-in Instagram scraping is deliberately not done; (3) prospect touches do not feed the daily 25 queue (needs a decision on whether prospects become `members` rows); (4) no found → joined funnel in `lib/analytics/funnels.ts`; (5) retention for rejected prospects and a privacy-policy line before any automation; (6) `pnpm types:gen` was not run for this migration (the local database was not available to this worktree), so `lib/data/database.types.ts` was edited by hand: run `pnpm types:check` and commit any diff.

**Priority:** Phase 1 in progress; the rest is roadmap only.

### Member Profile Pages
- **Attendance breakdown by Prickle kind and time slot**
  - Show attendance counts grouped by Prickle type (e.g. "Heads Down: 42", "Progress Prickle: 18")
  - Drill into Prickle type + recurring day/time slot (e.g. "Heads Down on Mondays at 5am: 12")
  - Filter to show only Prickle kinds or time slots where attendance is zero or low — helps identify patterns like "never attends evening prickles" or "dropped off Pop-Up Prickles after March"
  - Applies to both member self-view (My Prickles → Attendance History) and admin member detail

- **Attendance over time chart**
  - Show historical attendance patterns
  - Help identify engagement trends per member

- **Member status change tracking**
  - Track status transitions (active → hiatus → active, active → at-risk → active)
  - Show timeline: "Became at-risk: March 17", "Previously at-risk: Jan 5 - Jan 20 (returned after outreach)"
  - Helps validate at-risk detection and hiatus tracking
  - Shows engagement patterns over time
  - Hiatus is Hub-owned (admin-set, `member_hiatus_history`), so this has the data it needs

- **Working location and timezone**
  - Configurable per member
  - Enable "local time" analysis (e.g., "most people write in evenings globally")
  - Show what local time members are attending from

### "helpme" Hidden Debug Shortcut
Add a hidden keyboard shortcut (typing "helpme", similar to Confluent Cloud's debug overlay) that pops up a small debug panel showing:
- Environment name, git branch, and short commit SHA (same data already surfaced by `EnvironmentIndicator`/`EnvironmentInfo` in `components/EnvironmentIndicator.tsx` and `lib/config.ts`)
- The full list of feature flags from `lib/config.ts`'s `features` object (`debugMode`, `analytics`, `showEnvironmentBadge`, `verboseErrors`, and any added later) with their current enabled/disabled state

**Why a keystroke shortcut instead of always-visible UI:** Unlike `EnvironmentIndicator` (which is env-gated and only ever shows in non-production), this should work in production too, so admins/devs can check build/flag state on prod without needing a preview deployment — hence hiding it behind a deliberate keystroke sequence rather than always rendering it.

**Implementation notes:**
- Needs a small client component listening for the "helpme" keystroke sequence (buffer recent keydown events, reset on non-matching key, trigger on match)
- Reuse `lib/config.ts`'s `deployment` (branch/commitSha) and `features` objects rather than duplicating that data
- Since this is meant to work in production, it should not be gated behind `features.showEnvironmentBadge` the way `EnvironmentIndicator` is — consider restricting it to admin users only (auth check) since it may reveal internal build/config info

---

### Member Hover Card: Local Time, Touch, More Places _(Needs Scheduling)_
`components/member/MemberHoverCard.tsx` (profile at a glance on hover, shared by chat authors, the streaks page and the Big Sister cards) is deliberately small. Left for later: (1) Slack's card shows the person's local time and offset ("9:33 PM local time"); the Hub has no readable per-member time zone (`user_profiles.timezone_preference` is private and often `"browser"`), so it needs a decision on what members agree to share, then a field on `member_directory`; (2) it is hover and keyboard-focus only, so on a touch screen a tap follows the name's link and the streaks page no longer has a direct Slack shortcut there (a tap-to-open variant, or a Message action on the profile page); (3) other places that name another member (the members directory, prickle attendee lists, hosts, the dashboard, mentions inside chat messages, `<@U...>` tokens resolve to names in `lib/chat/names.ts`) should wrap their names in it; (4) "Message" is still a Slack DM link until Hub DMs exist, see "Big Sisters: message in the Hub".

### Chat attachments: wire-up, pgTAP, lightbox swap, zip
- `MessageFiles` now takes `canDelete`; `MessageItem` must pass `canDelete={message.mine}` (it was off limits for the change that added this). Until then the remove and Delete file controls never show.
- `chat_delete_file` (migration 20261208000000) has no pgTAP test yet (owner only, other member refused, deleted message refused, file dropped from the list, last file leaves `files` null). Add to `supabase/tests/database/`.
- The built-in enlarge overlay in `MessageFiles` should become `components/ImageLightbox` once that exists.
- **Resolved:** "Download all" is one zip from `/api/chat/files/<messageId>/zip` (a single file still downloads directly). The zip is built in memory (100 MB cap, 413 beyond it); streaming it would lift the cap. Deleting a file removes it from the Hub list only for Hub-written messages; Slack-origin messages' files are rebuilt from Bronze.
- **Resolved:** deleting a file from a Hub-written message now removes its bytes from the private bucket (`removeChatFileBytes`, `lib/chat/file-cleanup.ts`) after Slack and the Hub list are updated, unless another message still lists the same file, and soft-deletes the Bronze `slack_files` row (`deleted_at`, `copy_error = 'skipped: deleted'`, `storage_path` cleared). `ensureSlackFileCopied` and the import's copy step no longer re-fetch it. **Also resolved:** `sweepDeletedFileBytes` runs in the nightly chat run (`/api/process/chat`), and files deleted in Slack are cleaned up both ways: the `file_deleted` webhook (event added to `slack-app-manifest.yml`) and the Slack import (`removeFilesGoneFromSlack`: tombstones and files dropped from an edited message in the fetched history, at most 200 per run). Both ignore message lists that still name the file, since it is gone at the source. **Still open:** a file deleted in a message older than the 90-day fetch window is only caught by the webhook.

### Hedgie Help for admins without a member record
The top-bar Help menu (`components/HelpMenu.tsx`) shows in the admin area too, but `/help` lives in the `(member)` route group, whose layout redirects an admin with no member record (and no sudo) to `/admin`. Such an admin choosing Hedgie Help lands straight back where they were. Deferred because it is not known how many admins have no member record. Start by moving `app/(member)/help` to a route group that needs only a signed-in user, or exempting `/help` in `app/(member)/layout.tsx`.

## Internationalization

### Secondary Time Zone: Remaining Displays
Members talk about prickles in Eastern whatever their zone, so a member can opt in (Settings → Preferences, `user_profiles.secondary_timezone`, off by default, like Google Calendar's additional time zone) to see a second zone in parentheses beside theirs: "4:00 AM (7:00 AM ET)" (`lib/secondary-time.ts`, `components/SecondaryTimezone.tsx`). Usage is visible as the `secondary_timezone_changed` action outcome and the `settings-secondary-timezone*` click tracking. **Resolved:** upcoming rows, Events, the prickle picker, prickle details, All Prickles (table, calendar cards, commit slot labels), attendance history. **Still open:** the hosting schedule and its calendar picker, `lib/prickle-writing.ts`, Slack/email notification text, the calendar's hour column (Google Calendar shows a second column there), and a label next to the zone.

### Basic Date Format Localization (Needs Scoping)
Dates are currently always displayed US-style (`MM/DD/YYYY`), but many/most other countries prefer `DD/MM/YYYY`. Language should stay English and money stay USD (that's all Quill & Cup charges in and speaks) — this is scoped to date display only, not full i18n.

**Needs scoping before implementation:**
- Where dates are formatted today (likely scattered `toLocaleDateString()`/manual formatting calls across admin and member pages) vs. a shared date-formatting utility that could centralize this
- Source of the preferred format: browser locale (`navigator.language`) vs. an explicit per-member/user setting (ties into "User settings - additional preferences" under UI Enhancements, which already floats a "working location for global time analysis" preference)
- Whether this only affects display formatting, or also needs to affect date *input* parsing (e.g. any place a date is typed rather than picked via `<input type="date">`, which is locale-formatted by the browser natively already)

---

## Data Audits

### Access-date vs transaction-date audit (`kajabi_purchases`)
Find members/purchases where `effective_start_at` is more than ~7 days after the actual transaction date (`created_at_kajabi`). These purchases look like overlapping or out-of-order subscriptions in `detectResubscriptions`, which uses `effective_start_at` as the start of a membership period. A large lag between transaction date and access date can cause legitimate resubscriptions to be missed — e.g. a purchase made in January but access granted in February will appear to overlap with the prior subscription that ends in February, so no gap is detected.

Query: `SELECT * FROM bronze.kajabi_purchases WHERE effective_start_at - created_at_kajabi > interval '7 days'`

---

## Secrets at Rest

Where a secret lives depends on what the app does with it:
- **A credential we must hand to someone else** (a member's Slack token, a future provider key per member) goes in **Supabase Vault** behind service-role-only functions, with only a pointer in our table. `member_slack_connections` is the pattern (`20261021000000`).
- **A credential we only need to recognise** (single-use sign-in tokens, anything looked up by value) is stored as a **hash**, never the value. `slack_sign_in_tokens` already does (SHA-256).
- **App-wide credentials** (bot token, API keys, signing secrets) are env vars declared in `env-vars.config.ts`.

Audit (2026-10-10): nothing else needs moving to Vault, but two things are worth a look:
- **`calendar_feed_tokens.token`** is a plaintext bearer credential: anyone with the URL reads that member's hosted and committed prickles. It is read-only, scoped to one member, revocable ("Generate new link"), and the table is RLS-protected (owner and admins can read it), so this is low risk. It is a table value rather than a hash only because members can see their link again in Settings. Options if it matters: store an HMAC for the lookup and derive the displayed URL from a per-member secret, or hash it and make members regenerate to see it. Admins can currently read every member's feed token through RLS; at minimum drop that.
- **`push_subscriptions` `p256dh` / `auth`** are a browser's push encryption keys. Sending a push also needs our VAPID private key (an env var), so a leaked row alone can't be used to send. The table is service role only. Fine as is; revisit if it ever becomes readable by members or admins.

When Slack token rotation is adopted (see `docs/SLACK_BRIDGED_CHAT.md`, "Slack app configuration"), the bot token moves out of the `SLACK_BOT_TOKEN` env var into Vault too, since it then changes every 12 hours.

---

## Bug Fixes

### MemberCalendarClient: week and month navigation still use the host's zone
- **Missing:** `components/MemberCalendarClient.tsx` computes the current week start (`setDate`/`setHours(0,0,0,0)`) and the initial/previous/next month from the browser's zone, while the data and the grid cells are keyed in the member's `timezone` preference. When the two differ, the "current week" and "current month" can be the wrong one around midnight. `AttendanceMonthGrid` cell keys and "today" were fixed (they shifted a whole day); the navigation state was not.
- **Why deferred:** found while making unit tests zone-independent; a fuller fix means holding the week/month as zone-free calendar dates (see `startOfWeek` in `app/(member)/my-prickles/AllPricklesCalendar.tsx` for the pattern) and needs boundary tests.
- **Start:** `MemberCalendarClient.tsx` (`currentMonthDate`, `currentWeekStart`, `handleToday`), `AttendanceMonthGrid.tsx`, `lib/org-week.ts`.

### Reconciliation: Split monolithic endpoint and unify discrepancy logic _(refactor + code smell)_
- **Code smell:** `has_discrepancy` is currently a hybrid — computed server-side for Kajabi/Stripe in `/api/analyze/subscription-reconciliation`, but Slack absence is ORed in client-side in `app/(admin)/admin/reconciliation/page.tsx`
- **Root cause:** Slack, Stripe orphans, and Zoom access were already extracted into their own endpoints (`/api/analyze/slack-reconciliation`, `/api/analyze/stripe-orphans`, `/api/analyze/zoom-access`), but the subscription endpoint is still an all-in-one monolith that owns the `has_discrepancy` flag
- **Fix:**
  1. Split `/api/analyze/subscription-reconciliation` into separate endpoints (Stripe, Kajabi, etc.) following the same pattern
  2. Move all `has_discrepancy` logic client-side so the page computes it by combining all sources uniformly
  3. Remove `has_discrepancy` from the API response (it becomes a pure UI concern)

### Let a prickle's host report unmatched Zoom attendees _(feature idea)_
- **Idea:** Both prickle detail pages (`/admin/prickles/[id]` and `/(member)/prickles/[id]`) already compute `findUnmatchedZoomAttendees` and render `AliasSearchForm` — but the member-facing page gates it to `isActingAsAdmin` only, so a regular host never sees "these Zoom names showed up but didn't match anyone" for a prickle they hosted, even though the host is the one person who actually knows who that was.
- **Blockers found:**
  1. `app/(member)/prickles/[id]/page.tsx` — the `AliasSearchForm` render and its data fetch are conditioned on `isActingAsAdmin`; would need to change to "viewer is this prickle's host" (or host OR admin).
  2. `/api/aliases` and `/api/aliases/slack` are both `requireAdmin`-only. A host-facing version needs a scoped write path — only allow aliasing a Zoom name that actually appeared in a prickle that member hosted, not arbitrary alias creation — which is its own design/security decision, not a drop-in relaxation of the existing admin check.
- **Why not built yet:** Raised during the data-hygiene dashboard cleanup (see "Data hygiene / reconciliation dashboard cleanup" work); deliberately scoped out since the permission model needs its own design pass.
- **Planned shape: ask in real time.** While a prickle is running, automatically ask its host (a notification through `createNotifier`, with a link to the exact prompt) to say who an unmatched Zoom name is, using the join events already in `bronze.zoom_participant_events` / `lib/zoom-presence.ts`. For a Pop-Up Prickle (no host) ask the most senior member present instead, or a similar rule; "senior" needs a definition (tenure, hosting history, staff). The host's answers need the same choices an admin has: match to a member (alias), "ignore here" (this prickle only) or "ignore always".
- **Resolved:** admins can ignore a Zoom name for one prickle only (`ignored_zoom_appearances`, the "Ignore here" button on a prickle's page) or for every future appearance ("Ignore always", `ignored_zoom_names`). The host-facing scoped write path above is still open.
- **Guests and speakers aren't just "ignored".** An unmatched Zoom name on one prickle is sometimes a known person who isn't a member (a guest, a speaker). "Ignore here" now records a free-text reason, but that only hides the name. Decide whether to record who they were, or tag the attendee as a guest or speaker, so it counts for the prickle (and for `names_guest_speaker` prickle types) instead of vanishing. Start at `ignored_zoom_appearances` and `lib/prickle-unmatched.ts`.
- **Also resolved:** the all-time unmatched list (`/admin/hygiene/unmatched-zoom`) and the Data Health count drop appearances ignored on a prickle (`loadIgnoredAppearances`, `lib/ignored-zoom-appearances.ts`); a name leaves the list once every prickle it appeared on is ignored.

### Remaining places that format dates with the host's locale and zone _(hydration mismatch risk)_
- **What:** A bare `toLocaleDateString()` / `toLocaleTimeString()` / `toLocaleString()` formats in the host's zone, so the server render (UTC on Vercel) and the browser can print different text and React reports a hydration mismatch. It also breaks the `ORG_TIMEZONE` rule (`.claude/rules/dates-and-timezones.md`).
- **Resolved:** Every bare `toLocaleDateString()` in `app/` and `components/` except those below goes through `formatDateInZone` (the viewer's zone) or `formatDateOnly` (date-only values). `formatDate`, `formatDateTime`, `formatTime`, `formatTimeRange`, `formatDateTimeRange` and `formatRelativeTime` in `lib/formatters.ts` take a zone (default `ORG_TIMEZONE`, never the host's), their client callers pass `useTimeZone()`, and the admin calendar page computes its Sunday-to-Sunday week in `ORG_TIMEZONE` (`lib/org-week.ts`) and labels it with `formatDateOnly`.
- **Still open:** Bare `toLocaleString()` / `toLocaleDateString(undefined, ...)` / `toLocaleTimeString()` calls remain in several admin pages and panels (hygiene, wheel-of-wonder, gap-fills, feedback, reconciliation, insights tables, `SessionsPanel`, `NotificationInbox` tooltip, `MemberSlackActivityPanel`, `EventsBrowser`) and `en-US` ones without a `timeZone` (member profile, hosting, streaks, bookshelf, projects panels). Date-only values built with `new Date(`${d}T00:00:00`)` should use `formatDateOnly`; instants should use the viewer's zone.
- **Why deferred:** None is a known cause of an error; the shared helpers were the part that touched every prickle page.
- **Where to start:** `grep -rn "toLocale" app components lib`, skipping number `toLocaleString()` calls.

### Admin member activity tab hits the statement timeout _(Needs Scheduling)_
- **What is wrong:** `GET /admin/members/[id]/activity` died once with Postgres `57014` (`canceling statement due to statement timeout`, the API role's 8s limit; Sentry issue HUB-8, 2026-10-15, one event, so far). The page loads the feed through `fetchActivityFeed` in `lib/activity-feed.ts`, which calls the SQL functions `count_activity_feed` and `get_activity_feed` over `member_activities` (58,593 rows in prod on 2026-10-23). The Sentry event doesn't say which statement timed out, and nothing else has reproduced it.
- **Why deferred:** One event, no repro, and the cause may be a cold cache or a member with an unusually long history rather than a missing index. Not worth guessing at.
- **Where to start:** Run `explain (analyze)` for `get_activity_feed` and `count_activity_feed` against prod (read-only, `verify-against-prod.md`) for the members with the most `member_activities` rows, with and without the default filters. If the count is the slow one, a capped or estimated count may do. Keep HUB-8 open in Sentry until fixed. The same `57014` also showed in the project's events on 2026-10-22 and 2026-10-15 under other issues, so check whether it is recurring.

### `members.joined_at` throws away the time it was given _(Needs Scheduling)_
- **What is wrong:** The column is `timestamptz`, and its source, `created_at_kajabi`, is a real timestamp, but `app/api/process/members/route.ts` cuts it to a date (`created_at_kajabi.split('T')[0]`) before writing, so every value is midnight UTC (prod, 2026-10-23: 944 of 944 members, none with a time of day). Date-only values then get formatted as if they were instants: shown in Eastern a member can appear to have joined the day before, and the admin at-risk page needed `formatDateOnly` as a workaround.
- **What it should be:** the instant the member joined, kept as is and shown in the viewer's zone (`formatDateInZone`). Two things mix into it today and need a decision: a staff `hire_date` (a true date) replaces it when earlier, so convert that to the start of that day in `ORG_TIMEZONE` when it is used; and `first_joined_at` / `most_recent_joined_at` (and the `member_join_date_overrides` that correct the first one) are genuine dates, `DATE` columns, and should stay that way.
- **Why deferred:** Found while fixing date formatting (PR #353). Changing it needs a members reprocess and a look at the 27 files that read `joined_at`, to see which expect a date.
- **Where to start:** Stop truncating in `app/api/process/members/route.ts` and in `reprocess_members_atomic` (its latest definition is in `supabase/migrations/20261215000000_short_ids_tier1.sql`: read the newest `CREATE OR REPLACE` before editing). Then switch the readers to `formatDateInZone` and drop the `formatDateOnly(member.joined_at)` workaround in `app/(admin)/admin/at-risk/page.tsx`. Add a reprocessability test that a Kajabi time of day survives.

---

## CRM Features

### Slack Engagement Signals (ingestion and profile display are built)
Slack ingestion, the member-matching library and Slack activity on member profiles are done. Still open:
- Data hygiene UI for unmatched Slack users.
- Use Slack activity in at-risk detection (members who stopped posting, lurkers who attend but never post) and fold it into one engagement/risk score; refine `engagement_score` weights by activity type and recency.
- Staff alerts: "hasn't posted in 14 days (usually 3x/week)", "very active in Slack but no prickle in 30 days".
- Channel health metrics (messages per day, participation, dead channels).
- A wider activity feed (Slack messages, reactions, file shares, whitepaper downloads, email opens/clicks, retreat registrations) combined with attendance; same idea as the Dashboard's "Recent Activity Feed".

### Lesson Activity: Reconciliation, Churn Recency (follow-ups to the lesson activity rows)
Lesson viewing now writes `member_activities` rows (`lesson_watched`, `lesson_completed`, source `courses`; `lib/courses/activity.ts`), so it shows in the Activity Log and adds to the engagement score. Deferred:
- **Reconciliation.** The rows are a best-effort copy written next to the primary write, so a failed insert is logged and never retried, and a changed threshold or weight doesn't rewrite past rows. If drift shows up, add a pull-based pass (nightly) that re-derives missing rows from the source tables.
- **Churn recency ignores lessons.** `riskLevel` (`lib/member-engagement.ts`, `admin_members_page`, `/admin/at-risk`) is days since the last *prickle*, so a member who only watches lessons still rates "high" risk. Decide whether recency should count any activity type, or fold risk into the engagement score as a trend (recent points against the member's own earlier baseline); the three places apply the rule separately today.

### Host Confirmation Flow (not built)
After each prickle ends, message the host to confirm participants and resolve unmatched Zoom attendees. For unhosted prickles: TBD, options include assigning a random active member or the most senior hedgie (by join date or total duration excluding hiatus). Build it as a notification kind sent with `createNotifier`, not wired directly to Slack. Related: "Let a prickle's host report unmatched Zoom attendees".

### Payment Failure Notifications (not built)
On payment failure, notify the member (a `payment_failed` notification kind via `createNotifier`, Slack by default) to prompt them to update their payment method.


---

## Writing Projects Tracking

Full roadmap: `docs/superpowers/specs/writing-projects-tracking.md`. Core single-author flow (log progress against a project/goal, prickle-linked nudges, streak/chart stats) is scoped there phase-by-phase.


### Soft-delete the rest of the member-written tables _(Decided 2026-10-31: independent records only)_

Members' deletes of writing goals, progress entries, books and awards soft delete (`deleted_at`; see "Members' own business resources soft delete too" in `CLAUDE.md`). **Decided: the rule is independent records only**, with settings and in-place edits overwriting. So three member deletes stay row `DELETE`s on purpose:

- **Private member notes** (`member_notes`): clearing a note deletes it. A note is private to its author (no admin access, not audited, hidden in sudo) and saving overwrites the old text, so keeping a copy of a cleared note would work against why it is private.
- **Calendar-feed items added by hand** (`calendar_feed_items`, `removeMyCalendarItem`): a selection of what appears in the member's feed; the change is already in `audit_log`.
- **Starting balances** (`replaceStartingBalances` in `lib/data/writing.ts`): clearing a measure removes a baseline number that an edit also overwrites.

"Ask me about" topics were never a delete: the form saves the topics array (empty when cleared). Still open and small: if a restore path is ever built for progress entries, decide whether the entry's `member_activities` row should come back (the delete removes it so a bogus entry doesn't inflate engagement).

### Prickle Check-ins: Visibility Wording + Host Aggregates (Needs Scoping)
`prickle_checkins` (mood before/after, named feeling, intention, got what they came for) is readable by the member and admins, never hosts or other members. The check-in card deliberately says nothing about who can see responses yet. Open questions:
- Whether the card should say something (e.g. "Hosts can't see your individual responses").
- Whether hosts get aggregate trends for their prickles. Small prickles make aggregates identifying, so only show a prickle's (or a host series') aggregate once at least 5 distinct members checked in, and serve it through a SECURITY DEFINER function, never row access.

### Prickle Check-ins Phase 3: Admin Check-in Patterns (Needs Scoping)
Check-ins (`prickle_checkins`) and progress entries linked to prickles (`writing_progress_entries.prickle_id`) are live, and the Prickle Picker already uses a member's own checked-out check-ins (#54). Next is an admin view of each member's patterns, as a reach-out prompt:
- Per member: recent mood before/after (and the change), intentions, average "got what I came for" against their own baseline, and trend over time.
- Flag members whose pleasantness coming in has stayed low or fallen over a recent window (e.g. 3+ of their last 5 check-ins at 1-2), whose "got what I came for" has dropped well below their usual, or who stopped answering (people skip when they feel worst). See the measurement plan in `docs/CHECKINS.md`. Feeds the existing outreach touches (`/api/admin/outreach-touches`).
- Admins already have row read access to `prickle_checkins` (RLS), so this is an admin page plus queries, no schema change. Named feelings roll up to their Feeling Wheel core with `EMOTION_CORE` in `lib/prickle-checkins.ts`.
- Open: where it lives (member admin page tab vs a dedicated "check-ins" admin page) and the exact flag thresholds.

### Prickle Check-ins: Save Find a Prickle's Answers as a Check-in (Idea)
The Slack check-in DM now asks the check-in questions ~20 minutes before a prickle, for members with an active writing goal and the prickle on their calendar feed. The "How are you feeling?" answers in Find a Prickle (My Prickles → Find a Prickle, `lib/prickle-picker.ts`) still only pre-fill the check-in on the prickle the member clicks through to; nothing is saved unless they press Save there. Idea: save them as that prickle's check-in when the member picks it (and skip the check-in DM, which `checkinAnswered` already does once both answers exist).

### Prickle Check-ins Phase 3: Member Insights + Normalized Prickle Ratings (Wait for Data)
Only meaningful once a few weeks of check-ins exist.
- **Member insights:** a "What works for you" view on the member's own pages, e.g. "When you came in tense, focused prickles with Host X got you what you came for", and which prickles lift their mood most (pleasantness and energy after minus before). Reuse `similarCheckins` from `lib/prickle-picker.ts`.
- **Normalized prickle ratings:** score a prickle series by each member's "got what I came for" and mood change minus that member's own average, so a member who always answers low doesn't drag a series down (and one who answers everything "Completely" doesn't inflate it). Use it wherever series ratings surface (Prickle Picker ranking, host stats).
- Same privacy rules as check-ins: members see only their own; any host-facing aggregate needs at least 5 distinct members (see the check-in visibility entry above).

### Prickle Check-ins: Learn Feeling Suggestions from Searches (Needs Scoping)
The "Name the feeling" search suggests Feeling Wheel words for common words that aren't on the wheel ("stuck" → Frustrated, Discouraged, Helpless). That table, `EMOTION_SUGGESTIONS` in `lib/prickle-checkins.ts`, was written by hand from the old feelings list, so it only knows the words we guessed. Deferred from the Feeling Wheel PR (#361) to ship the redesign first.
- Record, anonymously, what members type into the feeling search and what they pick next (or that they picked nothing): the term and the chosen wheel word, no member id, so typed text can't be traced to a person. It is typed text, so it can't be a `track()` property (`docs/ANALYTICS.md`); it needs its own small table (service role writes, admin reads, with explicit grants per `supabase-table-grants.md`) or an aggregate counter per (term, pick).
- An admin view listing frequent terms with no exact match and what people chose for them, as input for new `EMOTION_SUGGESTIONS` entries (still added by hand and reviewed).
- Covers the in-app picker (`EmotionPicker` in `components/writing/CheckinFields.tsx`, which matches with `searchEmotions`). Slack filters its own select client-side, so those searches can't be seen.
- Add a line to the privacy page saying feeling searches are logged without a name.

### In-App Pipeline Visualization + Next-Stage Nudges (Needs Scoping)
Show each member, on their own writing project, a visual of where they sit in the overall Quill & Cup pipeline (idea → draft → self-edit → feedback → publish → launch/sell) — both to make the system visible ("we have a system, and you're on it") and to nudge them toward the next stage as they approach it, which doubles as adoption/revenue for the programs at each stage as they get built.

**Reference diagram:** `docs/pipeline-map.html` (open directly in a browser) is a first pass at the pipeline as a whole — stages, what's live vs. hired-out vs. still on the roadmap, and the parallel/fork points (Self-Edit Academy vs. hiring a Developmental Editor; Self-Publish vs. Query & Submit, with ARC Readers running alongside both rather than after them). It's a static reference/design source, not app code — treat it as the shape to translate into an in-app, per-project version, not something to embed as-is.

**This is a product/business decision as much as a build, not just a tech task:** most of the pipeline stages aren't Quill & Cup programs yet (Beta Readers, Self-Publishing Course, Trad Publishing/Query Course, and arguably Line & Copy Edit) — building the in-app visualization is a relatively contained UI feature, but *nudging members toward a stage* only pays off once that stage is a real, staffed program. Sequencing (visualize the roadmap now vs. wait until each program exists) is a call for Cody/Ania, not something to default on.

**How `writing_projects.phase` maps to the pipeline (resolved — see "How this maps to the app" section in `docs/pipeline-map.html` for the full reasoning):** the mapping is intentionally many-to-one, not something to fix by adding more phase values.
- `planning`/`outlining`/`drafting` → Draft (180 Program)
- `revising` → covers four diagram stages at once (Self-Edit Academy, Developmental Edit, Beta Readers, Line & Copy Edit) — `phase` can't and shouldn't try to distinguish these
- `complete` → both publishing forks (Self-Publish, Query & Submit), before either resolves
- `published` → Launch & Sell
- `on_hold`/`abandoned` → not pipeline positions; pause/exit flags that apply at any stage
- **Why not split `phase` further:** `phase` answers "how far along is the manuscript" (member-set from a simple dropdown); the pipeline answers "which program or vendor are you using," which has forks (DIY vs. hired, self-publish vs. query) a linear enum can't represent without conflating progress with vendor choice. Disambiguating which node a `revising` project is actually on belongs to program-enrollment data — the `member_products` table already planned above under Kajabi Data Expansion — once it exists, not a bigger phase list.

**Still needs scoping before implementation:**
- What a "nudge" actually is — a banner on `/writing`, a Slack DM (ties into the Messaging Abstraction Layer under CRM Features), an email, or just a visual marker with no push?
- Whether the visualization is linear per project or needs to show the same fork/parallel structure as the reference diagram (e.g. a member who hired a Developmental Editor shouldn't be nudged toward Self-Edit Academy) — likely blocked on `member_products` existing, per above
- How stages that don't exist yet as programs should render — greyed out/"coming soon," or hidden until built?

### Collaborative / Multi-Author Projects (Deferred — needs scoping)
Some members write as part of a group — e.g. Ania is one of ~7 authors writing separate novellas set in the same shared town, with intertwining characters (a shared-universe anthology). The core writing-projects data model is single-owner only and doesn't account for this.

Two genuinely different problems, not yet scoped:
- **Shared universe / collection** — each author owns their own separate project; projects group into a collection with mutual visibility across co-authors. Likely fit for Ania's case (separate books, shared setting) — lower complexity, no changes to the single-owner entry/RLS model, just a grouping layer.
- **True co-authored project** — multiple people log progress against one shared manuscript/project with a combined total. Needed only if some future project is genuinely one shared document rather than separate books. Bigger change: `writing_projects` needs multiple owners (collaborator join table), and the "member can only read/write their own rows" RLS assumption needs rework.

**Why deferred:** get the single-author loop (log → nudge → streak/chart) shipped and proven first; scope collaboration once that foundation exists rather than designing it speculatively now.

### Point-in-Time Goal Versioning (Deferred)
`writing_goals` rows are edited in place — `computeHabitGoalProgress`/`computeGoalProgress` always evaluate a goal's *current* definition (period, threshold, measure) against its *full* entry history. Editing period or threshold on an existing goal retroactively reshapes how every past period scores, with no record of what the goal used to say.

There used to be one narrow fix: changing a `measure='prickles'` goal's anchor archived the old row and forked a new one. Anchors were removed in October 2026 (no production goal used one; see Part 3 of `docs/COMMITMENTS.md`), and that fork went with them. When goals link to commitments instead, switching a goal to a different commitment should archive-and-fork the same way, so an earned streak isn't recomputed against the new slots.

**Still open:** editing threshold/period on any goal, or changing its measure, silently rewrites history. Real point-in-time versioning (a goal "changed as of" record, with past periods evaluated against whatever was true then) would fix this properly.

**Why deferred:** it's a known gap but hasn't caused a reported problem yet, and versioning every field is real design work (schema for change history, UI for "goal changed on this date," how charts/exports treat a versioned goal) beyond what's warranted to build speculatively.

### Browse Past/Archived Projects (Resolved)
**Resolved:** My Writing lists projects in a past phase (`complete`, `published`, `abandoned`; `PAST_PHASES` in `lib/writing-projects.ts`) apart from the ongoing ones, under "Past projects" (`app/(member)/projects/PastProjects.tsx`). Changing a project's status on its page moves it between the lists. Members can delete a project from its details modal (soft delete, `writing_projects.deleted_at`, with its goals and entries). There is deliberately no manual archive: it overlapped with the statuses (On hold, Complete, Abandoned). The `archived_at` column and the filters on it stay, but nothing sets it today.
