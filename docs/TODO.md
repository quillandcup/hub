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

### Slack Webhook: The Per-Event Activity Rebuild Doesn't Scale _(Needs Scheduling)_
Every Slack message, edit, delete and reaction webhook calls `triggerReprocessing("slack_messages", "bronze", { dateRange: ±1 day })` (`triggerSlackProcessing` in `app/api/webhooks/slack/route.ts`), and `/api/process/slack` answers each one by loading all members, aliases and Slack users, matching them in TypeScript, and DELETE + INSERTing the whole two-day window of Slack `member_activities` (one `reprocess_slack_activities_atomic` call per week of the range). The cost of one event grows with the day's traffic, so a busy day is roughly quadratic, and concurrent events rebuild the same rows at once (the same pile-up as the members deadlocks above). Fine at today's volume; it won't be once chat makes the workspace busier. The chat mirror avoids this by projecting just the touched message (`project_slack_chat_message`, `lib/chat-projection.ts`) and leaving the windowed run to imports.
- Do the same for activities: a per-message function that inserts, updates or removes the one activity row (keyed by `related_id = channel_id:message_ts`), using a saved Slack-user-to-member map (`chat_slack_authors` already holds one, rewritten by each full projection), and keep the windowed `reprocess_slack_activities_atomic` for imports and restriction changes (`exclude: ["slack"]` on the webhook's `triggerReprocessing`). It must keep the same rules as the rebuild: no text for DMs, group DMs or restricted channels, `engagement_value` from the same formula, deleted messages and removed reactions excluded.
- Until then, at minimum coalesce bursts per channel/day (or take an advisory lock) so concurrent events don't each rebuild the window.

### On-Demand Incremental Fetch for Every Source
Rule (CLAUDE.md, "Nothing through webhooks alone"): nightly reconciliation is the guaranteed path; webhooks and incremental fetches only reduce latency. Add a targeted incremental fetch per source so gaps heal in minutes instead of by the next nightly run:
- Slack: a webhook for a thread reply, reaction or edit on a message we don't have fetches that thread (`conversations.replies`) or the channel since the newest known message; opening a bridged chat channel does the same. Coalesce bursts to one fetch per channel.
- Zoom, Google Calendar, Kajabi: equivalent "fetch since the newest record we have" paths, triggered on demand (webhook gaps, admin button, page views).
- Record each gap-fill (source, scope, rows recovered) and surface it on `/admin/data-health`. A fill that recovers many rows means the webhook was down. Checkly can't see this: it monitors endpoints and heartbeats, not processed requests or logs.

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

### Course videos: a cleanup page for unused and long-draft videos _(Idea)_
Every video in Mux is billed for storage by the minute (about $2/month for the Ready Writer's ~650 minutes, `docs/COURSES.md`), and nothing today tells staff which uploads are no longer earning their keep. An admin page (under the Courses area, behind the `courses` flag) would list two kinds:

1. **Not used in a lesson.** A `videos` row that no `course_lessons.video_id` points at: the old asset after a lesson's video was replaced (the plan retires it "once nothing references it"), a lesson that was deleted in Kajabi, or a duplicate upload. `video_id` is `ON DELETE SET NULL`, so these accumulate quietly.
2. **Only in draft for N months.** A video whose lessons are all hidden (Kajabi drafts) and that was uploaded at least N months ago. N comes from a filter on the page (default 3 months, say). There is no "became a draft on" date today (a lesson's `updated_at` moves for any edit), so start with `videos.created_at` as the age, and say so on the page. A lesson that is only "Coming soon" doesn't count: those are planned and visible.

**Per row:** Mux asset id, duration, quality (`basic`/`plus`), status, uploaded on, the lessons that use it (linked, with their state), and the stored minutes, with a total at the top ("N videos, M minutes").

**Acting on it:** staff-only, and never automatic. A "Delete from Mux" button per row (and for a selection) that confirms with the minutes it frees, calls Mux's delete-asset API, then removes the `videos` row and its `video_text_tracks`. Refuse when a lesson still references the video (re-check at delete time, since a lesson may have been re-linked since the page loaded). Write each delete to the audit log. Deleting a draft's video means the lesson has to be uploaded again when it is published, so label that clearly.

**Notes:** the same page could also show videos stuck in `preparing` or `errored`. A matching page for `course_lesson_files` (copied PDFs no lesson lists any more) would follow the same pattern, though the files step already removes those itself.

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
- **Covers**: always cropped to Hub's 145×215 spec; a cover that fails to copy isn't retried on re-import (the project already exists), so the member has to upload it by hand.
- **Not in TrackBear's export at all** (would need their API or a TrackBear change): account-level lifetime starting balance, week-start and other settings, leaderboards.
- **One-click import**: TrackBear has no OAuth, and its API needs a member-created API key, so import is export-file upload. If TrackBear adds OAuth, switch to it.


## Infrastructure & Deployment

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

### Mask the Checkly Heartbeat Ping URLs in CI Logs
The `CHECKLY_HEARTBEAT_*` values are ping URLs: anyone who has one can mark that job as healthy. CI can print them in deploy logs. Register each with GitHub's log masking (`echo "::add-mask::$VALUE"`) at the top of the steps that use them (`checkly.yml`), so they show as `***`.

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
After "Move ticked names and emails to ..." in the Split dialog, the source member's
Identity tab kept showing the moved email for a short while before it disappeared. The
alias is deleted before the route responds, so this is probably the client router cache
holding the previous page render rather than the database lagging, but that isn't
confirmed. If it is, the split and move-aliases routes should `revalidatePath` the source
member's page (and the target's) so the next visit is fresh.

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

`.github/workflows/ci.yml`, `checkly.yml`, and `dependabot-auto-merge.yml` all pin
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

### Mux configuration as code (`mux:config`) _(Needs Scoping)_
Mux's settings live in its dashboard, unlike Supabase (`config.toml`), Slack (`slack-app-manifest.yml`), GitHub (`github-repo-config.yml`) and Vercel. Add a committed `mux-config.yml` plus `pnpm mux:config:diff` (read-only) and `:push`, modelled on `scripts/slack-manifest.ts`.

**What it can manage** (checked 2026-10-18; confirm endpoints before building):
- **Webhooks:** the Webhooks API (`/system/v1/webhooks`) creates them. It's scoped to the token's Mux environment, rejects a duplicate address with a 400, and returns the signing secret **only in the create response**.
- **Playback restrictions** (allowed domains/referrers) and **URL signing keys** exist as API resources.
- A Mux Terraform provider exists, but its resource list wasn't confirmed.
- **Spending alerts have no API** (dashboard only: up to 3, email only, paid plans). Keep them on a manual checklist in the docs.

**Needs a separate token with the System permission,** kept on the operator's machine or in CI, never in Vercel (the app token has only Mux Video and Mux Data).

**Per-developer webhooks.** A webhook has one URL, and a developer's tunnel domain (`TUNNEL_DOMAIN` in `.env.local`, see `docs/WEBHOOK_SETUP.md`) belongs to their own ngrok account, so every developer who wants real "video ready" notifications locally needs their own webhook. The script should make that one command:
- Production and preview environments come from `mux-config.yml` (production: `<APP_URL>/api/webhooks/mux`, from `lib/config.ts`).
- A developer's webhook isn't committed. `pnpm mux:config:push --dev` would create (or update) one pointing at `https://$TUNNEL_DOMAIN/api/webhooks/mux` in that developer's own Mux environment (separate from preview and production), and print the signing secret once for them to put in `.env.local` as `MUX_WEBHOOK_SECRET`.
- Re-running it is a no-op when the webhook already exists. If the tunnel domain changes, it updates the URL and keeps the secret.
- Without it, local development polls Mux, which is fine for most work.

**Secret handling:** because the signing secret is shown once, "create" has to hand it straight to the operator and never log it. Rotating means delete and re-create, then update the env files and `pnpm env:sync`.

**Priority:** after the course launch; the production webhook is created by hand once the route deploys.

### Google Calendar push channel: create and renew it _(Keep; needs scheduling)_
`/api/webhooks/calendar` receives Google Calendar push notifications (a "watch channel"), but **nothing in the app creates or renews the channel**; `docs/WEBHOOK_SETUP.md` describes creating one by hand with `curl`. Goal: a Google Calendar edit reaches the prickle schedule in minutes instead of by the next nightly reconcile (`/api/reconcile/calendar`, which stays the guaranteed path).

**State on 2026-10-18:** production saw one `GET` verification ping and no `POST`s in a week, so no active channel (channels expire and nothing renews them). The route rejects every request unless `X-Goog-Channel-Token` matches `GOOGLE_CALENDAR_WEBHOOK_TOKEN` (PR #105; token now in production). Google has no call that lists channels; one is stopped only by its `id` and `resourceId` (`POST /calendar/v3/channels/stop`) from the original watch response.

**Build:** a small `calendar_watch_channels` table (`channel_id`, `resource_id`, `expires_at`), created and renewed by a cron before expiry using the token as the channel token, stopping the old channel when replacing it. Record each gap-fill per "On-Demand Incremental Fetch".

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

### Clean Up React Compiler Lint Warnings
`eslint-config-next@16` enabled hook rules (`react-hooks/set-state-in-effect`, `immutability`, `exhaustive-deps`, `purity`) that surfaced ~49 errors in ~20 existing files. They were downgraded to `warn` in `eslint.config.mjs` instead of fixed. Fix the patterns and turn the rules back on. Also check `next dev` and Sentry source maps on the next Vercel preview.

---

## Security & Access Control

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

### Chat Drafts, Synced With Slack _(Needs Scoping)_
Save unsent message text per conversation (and per thread) in Hub chat, so leaving a channel or an expired session doesn't lose it. Slack keeps drafts too; sync both ways with the Slack bridge (`docs/SLACK_BRIDGED_CHAT.md`) so a draft started in Slack shows as unsent in the Hub and the reverse, and show "Drafts" in the chat list. Check which Slack API exposes drafts (and whether the bot or a member token is needed) before designing. Related: session expiry mid-form under "Return To".


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

---

## Analytics & Matching

### Member Matching Logic (In Progress)
Build fuzzy matching to connect Zoom attendance to members when emails aren't available:
- Name normalization (nicknames, variations)
- Manual mapping table for common aliases
- Confidence scoring

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

### Add an Icon Library
The app has no icon library: icons are inline SVGs pasted into components. Add one (e.g. lucide-react) and replace the hand-drawn crosshair on Settings' "Use current location" button (`app/(member)/settings/TimezoneSwitcher.tsx`) with its "locate" icon, then move the other inline SVGs over as they're touched.

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

### Course Hero Image _(Needs Scheduling)_
The course page (`app/(member)/courses/[slug]/page.tsx`) has a plain plum hero band, while Kajabi shows a banner photo behind the title (e.g. a notebook for Murky Middle) that is **not** the course thumbnail (the puzzle). Kajabi's course API only returns `thumbnail_url`, so the hero image can't be imported.

- Add `courses.hero_image_url` and let an admin set it (upload to storage, or paste a URL) on the admin course page.
- Render it as the hero backdrop under a dark overlay (`bg-black/60`) so the white title stays readable; with none set, keep the plum band.
- Until then, the sidebar shows the thumbnail, full width at the top of the card.

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

## Internationalization

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

### Prickle Check-ins: Visibility Wording + Host Aggregates (Needs Scoping)
`prickle_checkins` (feelings before/after, need, rating) is readable by the member and admins, never hosts or other members. The check-in card deliberately says nothing about who can see responses yet. Open questions:
- Whether the card should say something (e.g. "Hosts can't see your individual responses").
- Whether hosts get aggregate trends for their prickles. Small prickles make aggregates identifying, so only show a prickle's (or a host series') aggregate once at least 5 distinct members checked in, and serve it through a SECURITY DEFINER function, never row access.

### Prickle Check-ins Phase 3: Admin Check-in Patterns (Needs Scoping)
Check-ins (`prickle_checkins`) and progress entries linked to prickles (`writing_progress_entries.prickle_id`) are live, and the Prickle Picker already uses a member's own rated check-ins (#54). Next is an admin view of each member's patterns, as a reach-out prompt:
- Per member: recent feelings before/after, needs, average session rating against their own baseline, and trend over time.
- Flag members who've checked in "running low" or "wound up" repeatedly over a recent window (e.g. 3+ of their last 5 check-ins), or whose ratings have dropped well below their usual. Feeds the existing outreach touches (`/api/admin/outreach-touches`).
- Admins already have row read access to `prickle_checkins` (RLS), so this is an admin page plus queries, no schema change. Check-in feeling groups come from `FEELING_GROUP` in `lib/prickle-checkins.ts`.
- Open: where it lives (member admin page tab vs a dedicated "check-ins" admin page) and the exact flag thresholds.

### Prickle Check-ins: Save Find a Prickle's Answers as a Check-in (Idea)
The Slack check-in DM now asks the check-in questions ~20 minutes before a prickle, for members with an active writing goal and the prickle on their calendar feed. The "How are you feeling?" answers in Find a Prickle (My Prickles → Find a Prickle, `lib/prickle-picker.ts`) still only pre-fill the check-in on the prickle the member clicks through to; nothing is saved unless they press Save there. Idea: save them as that prickle's check-in when the member picks it (and skip the check-in DM, which `checkinAnswered` already does once both answers exist).

### Prickle Check-ins Phase 3: Member Insights + Normalized Prickle Ratings (Wait for Data)
Only meaningful once a few weeks of check-ins exist.
- **Member insights:** a "What works for you" view on the member's own pages, e.g. "When you came in stressed, focused prickles with Host X were your best sessions", and which prickles lift their mood most (feelings after vs before). Reuse `similarCheckins` from `lib/prickle-picker.ts`.
- **Normalized prickle ratings:** score a prickle series by each member's rating minus that member's own average, so a member who always rates low doesn't drag a series down (and one who rates everything Great doesn't inflate it). Use it wherever series ratings surface (Prickle Picker ranking, host stats).
- Same privacy rules as check-ins: members see only their own; any host-facing aggregate needs at least 5 distinct members (see the check-in visibility entry above).

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

### Browse Past/Archived Projects (Deferred)
`writing_projects` already has `phase IN ('complete', 'abandoned')` and `archived_at`, but there's no UI to list/browse projects in those states — `getMyProjects()` only returns `archived_at IS NULL` projects, so a completed or abandoned project effectively disappears from `/writing` once marked as such.

**Why deferred:** the data model already supports this; it's purely a missing browsing surface, not a schema gap. Distinct from goal-level "Past goals" (`getArchivedGoals`, shipped alongside the `prickles` measure — see `app/(member)/writing/[id]/ProjectDetailClient.tsx`), which covers archived *goals* within a project, not archived *projects* themselves.
