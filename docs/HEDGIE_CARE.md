# Hedgie Care: tracking a community manager's reach-outs

The community manager reaches out to members (an introduction, a check-in on their writing, a welcome back) and some of those turn into long conversations. She started with a spreadsheet, one row per message. **Hedgie Care** tracks it in the Hub instead: one record per **care plan** (one reach-out period with one member; the code, table and events still call it an engagement), a status that follows from the dates and who spoke last, and results measured against the member's own activity before, during and after.

Status: **built** (2026-11-11): write access, the `care_engagements` table, the repository, the measured results and the page at `/admin/care`, with manual logging. **Slack DMs fill in who spoke last** (step 2, 2026-11-11): her tracked 1:1 DMs, below. Email filling in the messages, the cohort comparison and the import of her sheet are design and are in `docs/TODO.md`, "Hedgie Care: what is left". It replaced a first build called Conversations (one open-ended row per member and channel), which was never announced and had no rows.

## Why not the spreadsheet, and why not Outreach

- **One row per message** hides the thing she asked for: how a reach-out is going. "Add a new row to contact them again" gives a history but no way to say "this is still the same engagement".
- **Most columns are derivable.** Date reached out, channel, whether and when they replied are facts the Hub can see. Typing them is the part that gets skipped when she is busy.
- **Outcomes need the member's record.** Whether a hedgie came to a prickle after a check-in is in `member_activities`; a sheet can't see it.
- **Outreach (`outreach_leads`, `outreach_touches`) is the wrong base.** It is about prospects, with a daily queue that only picks members with an Instagram handle, and the community manager can't open `/admin/outreach`. What is worth copying is the pattern: each event is also written to the member's timeline (`member_activities`).

Do not call these "check-ins": that name belongs to the prickle mood check-ins (`prickle_checkins`, `docs/CHECKINS.md`). The program is **Hedgie Care**; the unit on the page is a **care plan** ("Start a care plan", "Renew this care plan", "second plan"); one is started for a **reason**. **Why "care plan":** a plan has an explicit timeline, and when it ends there is simply no explicit plan for the member, not "we stop caring". The words went from "engagement period" (confusing next to the **engagement score**, below) to "care period" and then to "care plan" (2026-11-12); the page, its buttons, dialogs, messages and this document say care plan, and a plan in a chain of renewals is called by its ordinal ("first plan", "second plan": `planOrdinal`, `lib/care.ts`), never "Period 2". Only the words changed: the table (`care_engagements`), columns, routes, config keys (`careEngagementDays`), events (`care_engagement_*`) and code keep the older names, which `docs/TODO.md` tracks. Where this document still says "period" in prose it means a care plan's stretch of days (`period_ends_on`, `periodEndsOn`). The **engagement score** keeps its name, and so does "engagement" wherever this document talks about the code.

### Next to the Big Sister program, and the work queue

Hedgie Care is a **sibling of the Big Sister program** (`docs/BIG_SISTERS.md`: every new member is matched with a big sister for 30 days). The same person is likely responsible for both. "Welcome" (and "introduction") is a reason here **on purpose**, so a welcome she sends is tracked the same way as any other reach-out; it overlaps what a big sister does and the two are not tied together. The admin work queue's hiatus nudges and welcome-back suggestions (`/admin/work-queue`) also overlap, and are left as they are: they say who might need a message, Hedgie Care records that she sent one.

## What the system fills in, and what only she knows

| Her column | Source |
|---|---|
| Hedgie / member | A member picker (`EntitySearch`), so it links to the record |
| Date reached out, how, response status, date they responded | **Derived** from messages: Slack DMs she tracks (built, "Slack DMs fill it in" below), email later. Where nothing is derived she logs it by hand ("They replied", "I replied") |
| Type of check-in (the reason) | Hers: Introduction, Welcome, A check-in, A writing check-in, Encouragement, Something else (her sheet's own dropdown, with Welcome and Introduction kept apart) |
| Brief notes, follow-up date, next step | Hers |
| How it ended | Hers: four endings (below), her own read of it (`CARE_ENDED_HOW` in `lib/care-values.ts`, and the `ended_how` check in the migration: the only two places) |

## A care plan

One row is one **care plan**. It has an end date, and when the period is over she **renews** it (a new row that links back to the one before, `renewed_from`) or **closes** it with how it ended. A long relationship is a chain of periods, each with its own start, its own end and its own measured results, so "did the 30 days work" has an answer per period.

- **Length is config, not code:** `careEngagementDays` in `app.config.ts` (read through `lib/config.ts`). It starts at **30; the community manager should confirm it.**
- **The period's last day is an organization-timezone (Eastern) calendar date:** the day `careEngagementDays` days after the one it opened on, computed with calendar arithmetic (`periodEndsOn`, `lib/care.ts`), so neither a daylight saving change nor an evening opening (already tomorrow in UTC) can move it. The period runs through the whole of that day. Tests cover both sides of an Eastern midnight and both clock-change days.
- **One open care plan per member and channel** (a partial unique index), so a second hello continues the first.

### Status is derived: no job, no stored lifecycle

`careStatus()` in `lib/care.ts`, from the dates, who spoke last and the clock; nothing moves it in the background.

| Status | Rule (first match wins) |
|---|---|
| Closed | she closed it, or renewed it |
| Needs your reply | the member wrote last (their message is later than hers, or hers is missing). **However old the period.** |
| Lapsed | the period ended more than `careLapseGraceDays` (14) Eastern days ago and nobody dealt with it |
| Review due | the period has ended, inside the grace window: renew it or close it |
| Gone quiet | nothing from either side for more than `careQuietDays` (14) days |
| Waiting on them | she wrote last (or opened it) and the quiet window has not passed |

**The lapse rule.** A member who wrote last is never silently dropped: it stays "Needs your reply" until she replies, renews or closes it, even months after the period ended. Everything else with a period that has run out waits a grace window for her, and then **lapses** into the Earlier tab, so the Active list cannot grow forever. A lapsed engagement is still open in the database: she can renew it from Earlier. The grace window and the quiet window are config (`careLapseGraceDays`, `careQuietDays`); all three numbers are starting points to settle from real use.

### How an engagement ends

Four endings, plus `renewed`, which only Renew sets. The close dialog lists them top to bottom with a one-line definition under each and the measured results beside them; **the first that fits is the one to pick**:

| Ending | Means |
|---|---|
| **Handed to someone else** (`handed_off`) | The need was not hers (billing, Big Sister, a host, an admin). The note says to whom. Also used if a member asks her to stop, and she tells an admin in the note. (There is deliberately no "do not contact" ending or warning: the owner doubts it fits a subscription whose point is accountability.) |
| **No reply** (`no_reply`) | She wrote and they never answered, even after a follow-up. Never if they replied even once. |
| **Back in the community** (`back_in_community`) | They replied **and** the measured results show participation resumed after her first message. |
| **Ran its course** (`ran_its_course`) | The exchange is done, or they are content but busy (not in a writing season, busy at home, no sign they might leave) and nothing is pending; consider setting a later check-in date. |

If the conversation is still alive and she has a concrete plan, she **renews** instead of closing. The start form gives each reason a one-line guide the same way (`CARE_REASON_HELP`).

### Renewal is a decision, not a habit

Renewing starts the next care plan from today (a renewal's start is the renewal day) and asks for a **short reason** (what is the plan; at most 1000 characters), which becomes the **new period's note**, and shows the engagement's measured results at that moment. A row says "Period N", counted along the `renewed_from` chain (an ancestor that was removed ends the count there). The typical period is `careEngagementDays`; she can close earlier any time, and renew before or after the period end, including a lapsed one from Earlier. A renewal keeps the owner.

### Starting in the past, and changing a start (built 2026-11-12)

She enters conversations after the fact, so a care plan can be started on (and moved to) the day it really began. The rules, all in `lib/care.ts` and the repository, so the form, the action and the tests share them:

- **The day is an Eastern calendar day**, picked with the shared `DatePicker` ("When did this start?"), **today by default and never after today** (a day that has not begun in Eastern time is refused, even when it is already tomorrow in UTC; a day that is not real is refused). The action validates it again (`startDayProblem`), so a call that skips the form gets the same answers.
- **How it is stored (`careStartInstant`).** Today is **now**. An earlier day is **noon Eastern of that day** in `opened_at`: a time that exists on every day (clocks change at 2 a.m.) and sits well inside the day, so the day it lands on is never in doubt. The period's last day (`period_ends_on`) is the chosen day plus `careEngagementDays`.
- **The first message** ("They wrote to me first" ticked or not) is recorded for that day too, but for an earlier day it is placed at the **start** of the Eastern day, not at noon (`careFirstMessageInstant`). It is only a placeholder for "somebody wrote that day"; Slack DMs count from the start of that day, and a time only moves forward, so a real DM from that morning replaces the placeholder instead of being hidden behind a made-up noon.
- **Change start date** (`changeEngagementStart`, `CareRepository.changeStart`; a `care.write` staff action, wrapped in `withAction`, event `care_start_date_changed`) works on an open or a closed care plan with the same day rules. **The last day moves with the start and keeps the length the period had** (`shiftedPeriodEnd`: from the Eastern day it opened on to its last day, not today's `careEngagementDays`), so one that ran 45 days still runs 45 and the end can never fall before the start. A first message that is still the placeholder opening wrote moves to the start of the new day; times that came from a log or a DM stay. A start already on the chosen Eastern day changes nothing (the time of day stays). The audit log shows the change as a delta of `opened_at` and `period_ends_on` (the existing trigger; the message times are left out of it as before).
- **The chain stays in order.** A care plan can't start before the one it continues (`renewed_from`), after the one that continued it, or after it was closed; the page says which day stops it. A start on the neighbour's own day is allowed and takes that neighbour's moment when noon would put it out of order (`clampToChain`). A removed neighbour is no limit. A **renewal's start stays the renewal day** unless she moves it, inside that order.
- **One open per member and channel is untouched:** the index is on `member_id`, `channel` and "not closed, not removed", none of which a start change writes (the update is conditional on the start it read, so a second change in between is refused as "gone").
- **Slack DMs pick up earlier messages:** the derivation counts from the start of the Eastern day it opened, so a start moved earlier (or opened in the past) brings those DMs in, at once for the acting user's own tracked DMs and when the owner next opens the page. Moving a start later does not unwind times a DM already filled in.
- **The member's timeline row moves with it.** The row written when the plan opened (source `care`, type `care_started`, or `care_renewed` for a renewal, `related_id` the plan) takes the new start (`ActivityRepository.moveOccurredAt`, both implementations and the contract). A community manager can insert timeline rows but not change them (RLS), so it runs with the service role after the staff check and `care.write`, best effort like the row's creation (a failure is logged, the plan is the record); only `occurred_at` changes (the description carries no date), and only when the start really changed. It is the plan's start, never the member's membership start; the close row is not touched.

### Owners

Every engagement has an **owner** (`owned_by`, an admin or the community manager; several people can own engagements). A new engagement takes the owner of **that member's latest engagement** (continuity), else whoever starts it; a renewal keeps it; anyone with `care.write` can **reassign** it (open or closed) to another admin or community manager (checked against the profile's role, read with the service role because a community manager's own client cannot read other users' profiles; only ids, display names and roles are used). The audit log shows an owner change as a delta of `owned_by`. Both tabs have a **Mine / Everyone** filter, a row of **avatar chips** (one per owner here, with a count; click to filter, click again to clear) and a search over the team; the choice is the `?owner=` query (`me`, `unassigned` or an auth user id) within a tab.

### Lapse is an accountability signal

The page opens with the number of **lapsed** and **review due** engagements, and, when any are overdue, a small table of **whose** they are (including "Unassigned"), so a capacity problem is visible to the community manager and to admins alike. The Earlier tab shows the lapsed count too. Lapse stays derived: no cron moves it. **Not built:** a reminder to the owner when a period reaches "review due" and an alert to admins when one lapses. Both must go through `createNotifier` with registered kinds and start in dry run behind a feature flag (`CLAUDE.md`, "Member Notifications" and "A new automated sender starts in dry run"); see `docs/TODO.md`.

**Active** = open and not lapsed. The page has three tabs, which are paths (`CLAUDE.md`, "Tabbed Pages"): `/admin/care` (Active: needs reply, review due, gone quiet, waiting), `/admin/care/earlier` (closed and lapsed, most recently ended first, paged) and `/admin/care/dms` (Your DMs: her 1:1 Slack DMs with members, to choose which fill in who spoke last; read only when that tab is asked for, so the other two never wait on Slack's Bronze). Actions: **Renew** (closes this period as renewed and opens the next in one step: `renew_care_engagement`, a database function, safe against a double click because the close is conditional on the engagement still being open), **Close** with how it ended (every ending except "renewed", which only Renew sets), log a message, set a follow-up day, edit, remove (soft delete).

## Data model

Local layer (operational data owned by this app, not reprocessed). Ids are text and server-made (`care_` prefix); the member id is `text REFERENCES members(id)`. This is Tier 2: **no id appears in a URL, link or export** (the page never links by engagement id).

- **`care_engagements`** (`20270626000000_hedgie_care.sql`): `id`, `member_id`, `opened_by` (staff, uuid: it references auth), `reason`, `channel` (`slack_dm`, `prickle`, `email`, `other`), `opened_at`, `period_ends_on` (date), `renewed_from` (the engagement this one continues), `closed_at`, `ended_how` (null while open, set with `closed_at`: a CHECK keeps the two together), `last_staff_message_at`, `last_member_message_at` (both null when nothing is derived or logged), `follow_up_on`, `next_step` (at most 280 characters), `notes` (at most 1000, short and light: no sensitive detail), `deleted_at` (soft delete: a member's reach-out is a record of someone), `created_at`, `updated_at`. Reasons, channels and endings are checked sets; the sets live in `lib/care-values.ts` and the migration only. `owned_by` is the owning staff user (uuid, `ON DELETE SET NULL`).
- **`care_tracked_dms`** (`20270630000000_care_tracked_dms.sql`, id prefix `caredm_`): the 1:1 Slack DMs a staff member chose to track. `id`, `tracked_by` (the staff user, uuid, references auth, cascades), `slack_channel_id` (the Slack DM conversation id: an external id Slack made, not one of ours, and not a foreign key because Bronze is rebuilt), `member_id` (the other person in the DM, `text REFERENCES members(id)`), `created_at`, `deleted_at` (untracking is a soft delete; tracking again adds a new row). A partial unique index keeps one live row per user and DM. **No message content, ever.** `CareTrackedDmRepository` (`lib/data/care-dms.ts`). Metadata of the messages themselves is not copied anywhere either: the derived times are the two `last_*_message_at` columns above, which Bronze can rebuild at any time (the `conversation_messages` table this section once sketched is not needed and is not planned).

**Access.** Reads and writes are for admins and the community manager: `requireStaffAction()` beside `requireAdminAction()` (`lib/admin-auth.ts`), the routes in `isCommunityManagerPath` (`lib/staff-access.ts`) starting with `requireStaffPage()`, and RLS with `is_community_manager()`, never a widened `is_admin()`. RLS lets staff read, insert (with `opened_by` forced to the caller) and update; there is **no DELETE grant** and no `anon` grant. Her write controls are the opt-in staff feature **`care.write`** (`STAFF_FEATURES`), granted to her (every admin has every feature); a future staff role gets neither the page nor the feature until added. Every action is wrapped in `withAction`. **Tracked DMs are narrower than the engagements:** `care_tracked_dms` is readable and writable only by the staff user whose row it is (RLS: `tracked_by = auth.uid()` and admin or community manager; an admin does **not** read a community manager's list, and nothing widens `is_admin()`); a user can add a row and set `deleted_at`, nothing else (column grant); there is no `DELETE` grant and no `anon` grant; pgTAP covers each.

**Audit.** The `care_engagement` entity is audited by three triggers; the update one leaves out `updated_at`, `last_staff_message_at` and `last_member_message_at`, so logging a reply writes no row. `audit_row_change()` counts a community manager as staff (changed in the first build). A renewal is two entries by nature (the old period closed as "renewed", the new one inserted with `renewed_from`). **`care_tracked_dms` is deliberately not audited:** it is a staff member's private working list ("which of my DMs feed my engagements"), and the audit log is readable by admins, who must not see another staff member's list (`docs/ACTIVITY_AND_AUDIT_LOG.md`, "Deliberately not audited"). The engagement's `last_*_message_at` stay out of the audit trigger, so a derivation writes no audit row either.

**Timeline.** Starting, renewing and closing write a `member_activities` row (source `care`, types `care_started`, `care_renewed`, `care_closed`, actor staff, engagement 0, `related_id` the engagement) from the server action, best effort, with the reason, channel and, on a close, how it ended. Never her notes. RLS gives a community manager an INSERT on `member_activities` for that source, as herself, and nothing else.

**Removal request.** `member_data_handling` says `care_engagements.member_id` is deleted with the member. A member merge drops the duplicate's engagements for now (`NOT_MOVED`, `lib/member-merge-coverage.ts`; `docs/TODO.md`).

The repository is `CareRepository` (`lib/data/care.ts`) with a Supabase class, an in-memory twin and one contract suite, and the table is registered in the guard test.

## What success is

The owner's definition of success for the program. **Primary: churn reduction through engagement and belonging.** **Secondary: upsell** into courses, programs and opportunities that fit where a writer is in their journey. The graded retention view below is how the first is read (active, on hiatus or cancelled at each checkpoint, and the first time they lapsed); the programs started and the commitments held are the start of the second (a course the member started is not derivable yet, `docs/TODO.md`).

## Measuring her influence

Each engagement is compared with the member's own activity. Nothing is stored: the windows are counted when she opens "Results" on an engagement (`getEngagementResults`, `lib/care-results.ts`), so any window can be recomputed for any date. The windows (`careWindows`, `lib/care.ts`; the numbers are config: `careBeforeDays` 28, `careAfterFromDays` 30, `careAfterToDays` 60):

| Window | From | To |
|---|---|---|
| **Before** | 28 days before it opened | when it opened |
| **During** | when it opened | the end of the period's last day, or when she closed it if that was sooner (a renewal closes the old period when the new one starts). Still running: counted up to now ("so far") |
| **After** | 30 days after the period's last day | 60 days after it. Until it has fully passed it reads "Not yet": a half-finished window would look like a result it is not |

Windows are half open (the start counts, the end does not). Before is exact 24-hour days; after is by Eastern calendar day. For each window the panel shows the parts, not a score (`engagement_score` is capped at 100 over 30 days and hides what changed):

- **Prickles attended**: distinct prickles, never attendance records (a member who leaves and rejoins one counts it once, `CLAUDE.md`, "Attendance Table Design"). From the `prickle_attended` rows of `member_activities`, which are one per member and prickle.
- **Slack messages**: messages and thread replies, not reactions.
- **Firsts**: whether their first prickle ever and their first Slack post ever fall in the window. Derived from the activity log (first row of each kind), not assumed.
- **Staying (graded retention)**, the way the primary goal is read. Not one number: **active, on hiatus or cancelled at each checkpoint** after the period's last day (`careRetentionCheckpointDays` in `app.config.ts`, starting at 60, 90 and 180 days, **for the owner to confirm**), each "Not yet" until it has passed, derived from membership history with the same engine as the Membership Timeline (`memberStatusTimeline`, `lib/member-status.ts`, the logic `recomputeMemberStatus` uses, now answerable for any instant). The three states are shown apart because they mean different things: **hiatus is roughly half a churn** (a member on hiatus has not left, and has not stayed either), and churning at day 31 would still mean Hedgie Care was fairly ineffective. Any weighting of the three for a later cohort view must be config, never code. Staff read as active. Nothing assumes what counts as churn.
- **First went on hiatus or cancelled**: the first moment after the engagement opened that they did either, as "N days after it started" (or none so far), so a day-31 lapse stays visible even if they came back later (`MemberStatusTimeline.firstLapse`: the start of the first hiatus or gap, or the end of an active stretch with nothing after it, since the timeline drops a trailing open-ended gap).
- **Commitment held** (the longer the commitment, the stronger the anti-churn signal): the programs they were enrolled in at each checkpoint, each with the length of its own cohort ("Example Program, 6 months", from the cohort's start and end dates). **There is no annual plan yet** (the owner, 2026-11-11); the longer commitments today are the courses The Ready Writer and Self-Editing Academy (6 to 12 months, membership included), so **program length is the commitment signal for now**. Annual plans are planned and need a dated look at Stripe's price interval (structured: `data.items.data[].price.recurring`; all 393 subscriptions in production on 2026-11-11 are monthly) and at how Kajabi offers are sold (they carry only booleans and a free-text price description) when they launch; see `docs/TODO.md`. Nothing is flagged as "long": the length is shown and she reads it.
- **Programs started**: the programs whose cohort starts inside the window (`ProgramRepository.enrollmentsOf`), by name and length. It includes programs that come with membership, so it is a list to read, not a count of upsells. This is the secondary goal's row (below).
- **People connected**: the distinct members they interacted with (`member_interactions`: DMs, thread replies, mentions, reactions, in either direction), **not counting staff**: every member who is in the `staff` table, and the person who opened the engagement (she is paid in comps and may not be in `staff`). If it rises after, the outreach opened a door; if only their contact with her rises, it did not outlast her.

The membership and program rows read tables she cannot all read with her own client. Her client can read the membership timeline's billing Bronze (Kajabi and Stripe customers, purchases, offers, subscriptions), the hiatus history and `members` (`20270430000500_community_manager_role.sql`), but no policy found gives her `member_status_overrides` or `member_program_enrollments`, which the membership at each checkpoint and the programs started need. That is why `getEngagementResults` hands the service role to `loadCareResults` after `requireStaffAction()` and `care.write`, and only the derived answer (member, on hiatus, not a member, program names) leaves it. Courses are **not** included: `course_access.starts_at` says access began (a membership grants many courses), not that the member started one (`docs/TODO.md`).

The reads are repository methods with both a start and an end date, paginated past 1000 rows with a stable order: `ActivityRepository.countsBetween` and `firsts` (`lib/data/activities.ts`) and the new `MemberInteractionRepository.counterpartsBetween` (`lib/data/member-interactions.ts`; nothing owned `member_interactions` before: the member network page reads it through an RPC). `member_interactions` was admin-only, so the migration gives the community manager a **read-only** `is_community_manager()` SELECT policy on it. It holds who interacted with whom, when and whether in the open or in private (DMs and private channels included), never what was said; she sees only counts on this page, but the policy lets her read the rows.

### On every care plan: the engagement score and last in the community (built 2026-11-12)

She used to type these into the note, so each row (and the Results panel) shows them, worked out when the page opens, never stored:

- **Engagement score, then and now.** The member's score and tier (at risk, active, highly engaged) when the care plan started and today, by the same rules as the member's own page: points of the 30 days up to the instant, capped at 100 (`computeMemberEngagementMetrics`, with `engagementScoreAt` for "as of an instant", `lib/member-engagement.ts`; `lib/care-scores.ts` loads them for the page). A prickle is worth 10, other activity a few points, and a login one; under 10 is at risk, 10 to 49 active, 50 and over highly engaged. Reads are batched: one `ActivityRepository.engagementRowsForWindows` for every row on the page (windows in chunks, only rows that carry points, paginated past 1000 with a stable order). The SQL function `admin_member_engagement` repeats the rule for the Members list and is left as it is (`docs/TODO.md`).
- **Last in the community** (`lib/care-participation.ts`): the latest thing the member did themselves anywhere in the Hedgie House, as a date and what it was ("3/19/2026, a Slack reaction (yesterday)"). It reads `member_activities` and counts only rows with **`actor_kind = 'member'`** and a type from a list: a prickle, a Slack message or reply, a Slack reaction, a prickle check-in or check-out, a prickle commitment, a lesson watched or completed, a writing log. It leaves out logins, feedback to staff, taking a check-in back, and everything staff or the system wrote (care, outreach, sudo, email events, a commitment an admin made while viewing as the member). A new kind of activity does not count until it is listed. `ActivityRepository.lastParticipation` finds it for all the members on the page at once: it looks back a week, a month, three months, a year and then all time, each step only for the members not found yet.
- **It is not the DM line.** "Last message: they wrote 3 days ago" (who spoke last in the care plan's messages, from the DM she tracks or what she logged) is its own line; the two new lines are about the member's own life in the community.
- **Access.** The community manager's own client reads `member_activities` (the policy added with the role), so the page uses it; nothing needs the service role. If either read fails, the page logs it and shows the rows without ("not available").
- Each label has a tooltip, and the Results panel prints the help in full, saying exactly what is counted (the sentences are the code's, `app/(admin)/admin/care/CareFacts.tsx`).

**Honest limits** (also on the panel)
- **These describe; they do not prove.** Nothing here shows the outreach caused a change. The business outcomes behind the page are churn reduction through engagement and belonging (primary) and upsell into other courses and programs (secondary); membership at the end and programs started are the two rows that look at them, and the cohort comparison below is what could say more.
- Some quiet members come back unprompted. A fair comparison is a group of similar at-risk members she has not contacted; that cohort view is not built (`docs/TODO.md`).
- At about 10 a week the totals stay small for months. Read individual before-and-after stories now and cohort numbers each quarter.
- Slack messages and people connected exist only as far back as the Hub's own records (the Slack activity mirror, the chat mirror behind `member_interactions`), so a "before" window early in that history can read low and a "first" can be the first the Hub knows of.
- Don't derive "who counts as at-risk" or "returned" from a guess: take it from membership history and the data (`CLAUDE.md`, "Business Facts: Derive, Don't Assume").

## Two kinds of follow-up (the second is not built)

1. **Inside an engagement:** `follow_up_on`, a day to look at this one again (built).
2. **When to open a new one:** mostly trigger-based: stopped attending prickles, engagement dropping against their own baseline, check-in ratings falling, hiatus milestones, new arrivals, hedgieversaries; plus a **`revisit_on` date set when she closes** one ("check in again in March"). Planned as a **derived suggestions list** with the reason shown, suppressing members who have an open or a recent engagement, with dismiss and snooze stored. Consider a new queue type in `admin_work_queue_completions` instead of a new table (verify first: it is admin-only today, so a community manager could not write it). **Members who qualified but were not contacted are the natural comparison group** for the results: the rules can be recomputed for any past date, so "who would have qualified then" is always answerable.

## Who owns it, still open

She, and possibly others (admins, a future second community manager), are the owners; `owned_by` supports several. Whether admins should own engagements day to day, or only be able to see and reassign them, is unresolved. So is who gets the overdue reminders: the owner, an admin, or both.

## Slack DMs fill it in (built)

The Slack DM bridge already pulls 1:1 and group DMs each night using a member's own Slack token (`lib/chat/slack-dms.ts`, `/api/reconcile/slack-dms`; `docs/SLACK_BRIDGED_CHAT.md`, "Slack 1:1 DMs through members' own tokens"). The bot cannot be in a 1:1 DM, which is why it is the member's token. When she has connected her Slack with the DM scopes and `slack_dm_bridge` is on for her, every DM between her and a member reaches Bronze. Hedgie Care reads **who wrote and when** in the DMs she chooses and nothing else.

### The decisions (the owner's)

- **Opt-in per DM.** A DM is tracked only when she says so: the "Your DMs" tab (`/admin/care/dms`) lists her 1:1 DMs with a Track switch, or it is tracked for her when she starts an engagement on "Slack DM" with a member she has a DM with (she can untrack it).
- **Staff are never offered.** A DM whose other person is staff is not listed and cannot be tracked: a member in the `staff` table (`staff.member_id`) or the member behind an admin or community manager account.
- **Group DMs are out of the first version.**
- **Metadata only.** Message text, files and raw payloads are never read, in the UI, logs, errors, analytics or the new table. The Bronze read is `SlackMessageRepository.lastWritesIn`: the database function `care_dm_last_messages` returns, for each Slack conversation and person, the time of their latest live message, reading the content-free `bronze.slack_messages_meta` view, with the service role only (the function refuses a signed-in user). Every caller checks who is asking first (`requireStaffAction()`/`requireStaffPage()`, then `staffCan(role, "care.write")`).
- **Only her own DMs.** The list is built from the DMs her own Slack user is in now (`SlackWorkspaceRepository.directMessagesOf(her Slack user id)`, the id coming from her own connection), never from a channel id someone supplies; another person's DM can't appear, not even for an admin. Tracking re-finds the DM in that same list, and the projection re-checks that she and the member are the two people in the conversation before it reads a word of metadata, so a row filed straight into the table (RLS only decides whose row it is) for a DM that is not hers reads nothing.

### What the page says (and what each sentence rests on)

"Hedgie Care reads who wrote and when in the DMs you track, never what was said. The Hub's Slack connection already brings your direct messages in for Hub Chat, and this adds nothing to that: only the DMs you track here fill in who spoke last on your Slack DM care plans. Other staff, admins included, don't see which DMs you track. Who spoke last shows on the care plan, which everyone who opens Hedgie Care can see. DMs with staff are never listed. Untracking a DM stops new times coming from it; what it already filled in stays." The first rests on `lastWritesIn` (above); the second on the DM pull (`pullMemberDms`), which this feature does not touch; the third on the table's RLS and its pgTAP test; the fourth on the engagements' staff-wide read policy; the fifth on `ownDirectMessages`; the last on the projection only ever moving times forward. **Open fact, still:** the pull reads **all** of a connected member's 1:1 and group DMs, so the opt-in limits what Hedgie Care uses, not what is pulled; `/privacy` is the owner's to word (`docs/TODO.md`).

### Open the DM

An engagement with a tracked Slack DM (hers, open or closed) and each row of the Your DMs tab has an **Open the DM** link (`lib/care-dm-link.ts`: `dmLinkTarget`, one small function so the choice can change as DMs move into Hub Chat). It leads to **Hub Chat** (`/chat/<conversation id>`, a Tier 1 id) when the Hub has that conversation and she is in it now (a Slack 1:1 DM reaches a member's chat once they have pulled their own DMs; `ChatRepository.idsBySlackChannels` and `joinedChannelIds`, so a conversation she is not in is never offered), else to **Slack** with Slack's documented `https://slack.com/app_redirect?channel=<DM id>`, adding `&team=<workspace id>` when `SLACK_TEAM_ID` is set (an existing, optional variable; without it Slack opens the DM in the person's default workspace, which is what Slack's deep-linking docs say). No workspace id is written in the code, and a link carries only ids, never text. Only the person who tracks the DM sees it: the link needs her tracked list, which is hers alone.

### Not built: the text of tracked DMs inside the tracker

She asked to see the conversation in the tracker instead of writing notes. **Not built, on purpose:** it would copy or render private DM content into a page every admin and community manager can open, and this design is metadata only (the privacy section above; Slack content is service role only; bridged DMs are restricted). The safe shape is the link above: the DM opens in Hub Chat, where it is already visible only to the people in it, or in Slack. The owner decides (`docs/TODO.md`).

### The rule for "who spoke last" (derived, `lib/care-dm.ts`, `lib/care-dm-rules.ts`)

For an **open** engagement on the **Slack DM** channel, owned by the staff user (`owned_by`, else who opened it) who tracks a DM with that member:

- the **staff side** is the latest message her Slack account wrote in that DM, the **member side** the latest one the member's wrote (the pair is matched by Slack user id through the Hub's Slack-to-member links, and re-checked in Bronze);
- a **thread reply** or **file share** counts; a **deleted** message, a Slack **join or leave notice** (`SLACK_SYSTEM_SUBTYPES`) and anything written by someone else in the conversation (a bot) does not;
- only a message **on or after the start of the Eastern calendar day the engagement opened** counts (`dmCountsFrom`, `ORG_TIMEZONE`): a message she sent earlier that day, just before logging the start, still counts; yesterday's does not. A calendar day, not 24 hours, so the 23-hour and 25-hour clock-change days and an evening opening (already tomorrow in UTC) land on the right midnight (tested on both sides of each);
- a time only ever moves **forward** (`CareRepository.moveMessageTimesForward`, one conditional update per side): a manual "they replied" that is later stays, and an older message never undoes anything;
- **idempotent and rebuildable**: running it again changes nothing, and it can be re-run from Bronze at any time. It writes no audit rows (the two columns are left out of the audit trigger).

It is **pull-based** (nothing relies on a webhook alone): **(a)** when she opens Hedgie Care (only her own tracked DMs, and only when she has some: the page reads what Bronze has and does not trigger a DM pull; Bronze is kept current by the live `message.im` events for covered members and the pulls when she opens chat), **(b)** after the nightly DM pull for every staff member's tracked DMs (`/api/reconcile/slack-dms`, inside the route's time budget; a failure or an out-of-time pass is reported with the run's other problems), and **(c)** when she tracks a DM or starts a Slack DM engagement. The webhook itself does not project: reading Bronze when the page opens is as fresh as a webhook would make it, since nothing sends her anything when a member replies (`docs/TODO.md` records it).

The status on the rows and the "Needs your reply" count follow from those times, and a small **from Slack** hint on a row says its last-spoke is kept up to date from her tracked DM, so a manual log isn't needed. (The hint shows on her own engagements only: nobody can read another staff member's tracked list.)

**What is hidden when** (the page's own condition is `followsTrackedDm`, `lib/care-dm-rules.ts`, the pairing the derivation reads: the **Slack DM** channel, an **open** period, **owned** by the signed-in user, who **tracks a DM with that member**; the page already loads her tracked list, so there is no extra read):

- **"They replied" / "I replied"** are hidden on such a period and the row says "Filled in from your Slack DM" where they were (the **from Slack** hint stays, and the "Last message" line). The DM sets both times and a manual log can only move them forward, so the buttons would do nothing useful. They stay on every period of another channel (prickle, email, other), on a Slack DM she has not tracked, and on one owned by someone else (nobody can read another staff member's tracked list, so the page can't tell). The `logCareMessage` action is unchanged and refuses nothing new.
- **"They wrote to me first"** on the start form is replaced by "Your Slack DM with them tells who wrote first." when the channel is Slack DM and the picked member is one whose DM she tracks **and whose new period she would own** (`membersWhoseNewCareFollowsDm`: a new period takes the owner of the member's latest one, else her, so a DM she tracks does not feed a period that someone else's continuity makes theirs). The tick is not sent ticked in that case. It stays for every other channel and for a Slack DM with a member she does not track. **Limit:** a member she has a DM with but has not tracked yet (starting tracks it, below) can't be told from one with no DM without a Slack lookup on every pick, so for them the tick stays; the DM then replaces the placeholder time it sets, because a time only moves forward.
- Under the buttons of an open period, a line says what **Renew** (starts a new care plan for them) and **Close** (ends this one and asks how it ended) do; the start form's button is "Start tracking" (the heading is "Start a care plan").

## Email (not built)

Resend can receive mail (`email.received`; the webhook has metadata only, the body comes from `resend.emails.receiving.get`; the list endpoint `GET /emails/receiving` gives the pull-based path the "nothing through webhooks alone" rule requires). Setup is the "Replies (phase 2)" item in `docs/TODO.md`, "Email timeline: what is left":

- Her own address on a subdomain whose MX points at Resend (`hub.` is a CNAME to Vercel, so it can't carry the MX; use the `reply.` subdomain already planned).
- Incoming: the webhook stores the metadata, the nightly pull recovers what it missed, and the message is forwarded to her inbox so she reads and answers it in her mail app.
- Outgoing: her mail app's "send as" through Resend SMTP, so her replies are in `bronze.resend_events` and the timeline. **To verify first:** that SMTP sends fire the same webhooks as API sends, and that the member is matched by address.
- A BCC habit is the fallback, not the design: it depends on her remembering.

## Build order

1. **Write access, the table, the page and the measured results** (built).
2. **Slack DMs fill status in** (built), with the per-DM opt-in above.
3. **The cohort view**: a comparison group on `/admin/at-risk`, which is already her home page.
4. **Email** through Resend, as above.

Deferred pieces are entries in `docs/TODO.md` ("Hedgie Care: what is left"): her sheet's import (a local one-off, never committed: member names stay out of the repo), a section on the member's profile, member-merge handling and a funnel for the events.

## Decisions to confirm with her

`careEngagementDays` (30), `careLapseGraceDays` (14) and `careQuietDays` (14) are starting points. So are the list of reasons, the four endings and the three windows. All are one edit: `app.config.ts` for the numbers, `lib/care-values.ts` and the migration's `CHECK` for the lists.
