# Commitments

A **commitment** is a member's promise to attend one or more recurring prickle slots for a set
number of weeks: "Mondays 7am Progress Prickle for the next 4 weeks", or "M/W/F 5am Sprint for 4
weeks." It's the attendee-side sibling of Hosting (`prickle_schedules`): Hosting is "I'll run
this slot", a commitment is "I'll show up to these slots."

Commitments give us an explicit, opt-in signal of intent. That's the anchor for **prickle check-ins**
(before) and **check-outs** (after). We build those on top of commitments first, and only
later try to infer intent heuristically for members who never commit (see
[Generalizing beyond commitments](#generalizing-beyond-commitments)).

Status: the MVP is built and live: the data model, making commitments from All Prickles, the
Commitments tab, progress tracking, and the 📌 commitment tier on Upcoming/Dashboard. Nudges and
follow-ups are **proposed only** (Part 2 of this doc).

---

## Part 1: What's built

### Data model

These tables are **Local layer** data: members own them, they use normal CRUD, and they're never
reprocessed.

- `supabase/migrations/20260926000200_create_prickle_commitments.sql` created
  `prickle_commitments`, originally with one slot inline.
- `supabase/migrations/20260927010000_commitment_slots.sql` moved the slot into a child table so a
  commitment can have several. It migrated any existing rows to one slot each (prod had none) and
  dropped the inline columns.

**`prickle_commitments`** holds the member and the window.

| Column | Notes |
|---|---|
| `id` | uuid PK |
| `member_id` | FK `members`, `ON DELETE CASCADE` |
| `start_date` | Each slot's first occurrence is the first matching weekday on or after this date |
| `weeks` | 1–12, default 4 |
| `end_date` | **Generated**: `start_date + weeks*7 - 1`. Used for window queries and future cron jobs |
| `status` | `active` / `completed` / `cancelled` |
| `cancelled_at` | Set iff `status = 'cancelled'` (CHECK constraint) |
| `created_by` | The real auth user (an admin, under sudo) |
| `created_at`, `updated_at` | |

**`prickle_commitment_slots`** holds 1..n slots per commitment.

| Column | Notes |
|---|---|
| `id` | uuid PK |
| `commitment_id` | FK `prickle_commitments`, `ON DELETE CASCADE` |
| `type_id` | FK `prickle_types`, `ON DELETE CASCADE` |
| `day_of_week` | 0=Sun..6=Sat, same convention as `prickle_schedules.day_of_week` |
| `start_time_local` | `TIME`, wall-clock time in `timezone` |
| `timezone` | Always the schedule's timezone, `America/New_York` (`SCHEDULE_TIMEZONE` in `lib/commitments.ts`): prickles repeat at a fixed New York wall-clock time across DST. The commitment's dates are local to it. The app shows slots in the member's own timezone (`slotInTimeZone`). Before migration `20260928000200` it was the member's timezone; that migration converted existing rows |
| | UNIQUE `(commitment_id, type_id, day_of_week, start_time_local, timezone)` |

Design choices:

- **Slot identity matches Hosting.** A slot is type + weekday + local time + timezone: a commitment
  is to a recurring slot, not to specific prickles. (Prickle ids themselves are stable: calendar
  prickles upsert on `calendar_event_id` and PUPs on `zoom_meeting_uuid`, so only a prickle whose
  calendar event or Zoom meeting is deleted goes away. That's why `prickle_checkin_dm_log` and
  `calendar_feed_items` can reference `prickles(id)` directly.)
- **One window per commitment.** All of a commitment's slots share `start_date`/`weeks`, so "M/W/F
  for 4 weeks" is one thing to track, renew, or cancel. Week *N* is the *N*th 7-day block from
  `start_date`. A slot whose weekday comes before the start date's weekday gets its week-1 session
  later in that same block.
- **The overlap rule** replaces the single-slot "one active commitment per slot" unique index. A
  member can't have the same slot in two **active** commitments whose **windows overlap**. The
  `enforce_prickle_commitment_slot_overlap` trigger enforces it, because the rule spans both tables
  and a partial unique index can't. The trigger fires after inserting a slot, and after updating a
  commitment's status, start date or weeks while it's active. A violation raises
  `unique_violation` (23505), and a per-member advisory lock serializes concurrent creates.
  - **Why overlap, not "one active per slot":** a session inside two commitments would count twice
    (and would get two nudges later).
  - **Renewals are allowed:** a new commitment on the same slots that starts after the current one
    ends doesn't overlap. The old index blocked that until the first commitment had ended.
  - **Mixing works:** committing to M/W/F while already committed to W for overlapping weeks is
    rejected. Committing to M/F alongside it is fine.
- **Atomic create.** `create_prickle_commitment(p_member_id, p_start_date, p_weeks, p_slots jsonb,
  p_created_by)` inserts the commitment and its slots in one transaction. It's `SECURITY INVOKER`,
  so RLS applies exactly as for direct inserts. An overlap or bad slot rolls back the whole thing.
- **`completed` is lazy.** `getMyCommitments` flips `active` rows whose window has passed to
  `completed` (best-effort). Status is also derived on read (`effectiveCommitmentStatus`), so a
  stale `active` row is harmless. A future nudge cron should filter on `end_date` rather than trust
  `status` alone.
- **Cancel, never delete.** Members have no DELETE policy. History stays intact, and so will future
  nudge logs.

**RLS** follows the `20260926000600` conventions:

- **Ownership** is `member_id = current_member_id()`, with `is_admin()` for admins. Sudo is covered
  because a sudo'd write runs under the real admin's session.
- **`prickle_commitments`:** members can SELECT, INSERT and UPDATE their own rows. There's no
  DELETE policy.
- **`prickle_commitment_slots`:** members can SELECT their own slots and INSERT into their own
  commitments (ownership is checked through the parent). Slots are immutable for members; changing
  slots means a new commitment. Admins can UPDATE and DELETE slots to fix data.

`tests/api/commitments/rls.test.ts` covers all of this against the local DB, including the overlap
rule and the RPC's rollback.

### Member UI

- **My Prickles → All Prickles** is where commitments are made. It doesn't use a dropdown, so it
  scales with the schedule.
  1. Click **📌 Make a commitment** to enter commit mode.
  2. In **Table** view, each Prickle Times row gets a checkbox. In **Calendar** view, clicking a
     prickle picks its whole weekly slot, and every occurrence of that slot is highlighted.
     Clicking a prickle that isn't on the upcoming schedule does nothing. Picks carry across both
     views. Outside commit mode, calendar clicks still open the prickle.
  3. A small panel (`CommitPanel.tsx`) lists the picks as removable chips. It has a weeks selector
     (1–12, default 4) and a start date. The start date defaults to today, or to the first day on
     which no picked session has already started (`defaultCommitmentStartDate`). A preview shows the
     window, e.g. "12 sessions: Mon, Sep 28 – Fri, Oct 23".
  4. **Commit to these N** makes one `createCommitment` call.
- **Deep links:**
  - `/my-prickles?tab=all&commit=<seriesKey>[,<seriesKey>…]` opens commit mode with those slots
    picked. An empty `commit=` opens it with nothing picked.
  - The older `?tab=commitments&slot=<seriesKey>` link lands in the same place.
  - A `seriesKey` is `PrickleScheduleRow.seriesKey` (type + local weekday/time in the viewer's
    timezone). Calendar instances now carry it too (`PrickleInstance.seriesKey`).
- **My Prickles → Commitments** (`CommitmentsManager.tsx`) links to All Prickles to make a
  commitment, and lists active and past commitments. Each card shows:
  - A title that collapses shared type/time ("Sprint · Mon, Wed, Fri · 5 AM EDT").
  - The window and the total progress ("5 kept · 1 missed · 6 to go").
  - One row of weekly dots per slot (kept, missed, pending, upcoming, or no session), with that
    slot's kept count.
  - A two-step cancel for active commitments.
- **Upcoming / Dashboard** (`lib/upcoming-prickles.ts`): an upcoming prickle matching **any** slot
  of an active commitment gets the commitment ranking tier (just below hosting) and the 📌 badge.
  The tooltip depends on how many sessions a week the commitment has:
  - One: "Week 2 of 4 · 1 kept so far".
  - Several: "Week 2 of 4 · 5 sessions kept so far".

### Progress: kept vs. missed (`lib/commitments.ts`, pure)

For every slot × week of the window:

1. **Expected start**: the slot's `start_time_local` on that date in its `timezone`, converted to
   UTC. This is DST-aware (`zonedTimeToUtc`).
2. **Match prickles to occurrences one-to-one** (`assignOccurrencePrickles`). Take every
   same-type prickle within **±60 minutes** of an expected start, closest first, and use each
   occurrence and each prickle at most once.
   - The tolerance covers one-off time changes. (It also absorbed the DST gap for slots stored in a
     member's own timezone, before slots moved to the schedule's timezone.)
   - Closest-first matching means an adjacent-hour slot of the same type only matches when the
     committed one didn't run.
   - Two slots of one commitment can never claim the same prickle.
3. **Classify each occurrence**:
   - `kept`: the member has any `prickle_attendance` row for the matched prickle. Multiple
     join/leave rows collapse to one, since the check uses a set of distinct prickle ids.
   - `upcoming`: the prickle hasn't started. Future occurrences never count.
   - `pending`: the prickle ran, there's no attendance yet, and it ended less than 24h ago.
     Attendance is imported on the Zoom `meeting.ended` webhook and by the nightly reconcile, so it
     can lag.
   - `missed`: the prickle ran, there's no attendance, and the 24h grace period is over.
   - `no_session`: no matching prickle ran that week (a holiday, or a cancelled calendar event).
     This isn't held against the member.
   - After a cancellation, later occurrences are dropped rather than counted as missed.
4. **Summarize** as totals per commitment and `perSlot` counts. Each occurrence carries its
   `slotIndex` and 1-based `week`.

Data fetching happens in `getMyCommitments`
(`app/(member)/my-prickles/commitment-actions.ts`):

- One query for the member's commitments with their slots embedded.
- One paginated query for prickles of the relevant types across the union window
  (`commitmentsFetchWindow`).
- The member's `prickle_attendance` for those prickle ids, fetched in batches of 100 ids with
  each batch paginated.

`createCommitment` validates input in the pure layer (`validateCommitmentInput`):

- 1–14 distinct slots, all in the schedule's timezone (`SCHEDULE_TIMEZONE`).
- A start date between today and 60 days out, and 1–12 weeks.
- No picked session has already started on the start date.

It then checks each slot against real prickles in the next 21 days, pre-checks the overlap rule
for a friendly message, and calls the RPC.

### Activity log

Creating a commitment writes a best-effort, append-only `member_activities` row, following the
same pattern as writing progress and outreach touches (`docs/ACTIVITY_AND_AUDIT_LOG.md`):

- `activity_type = 'prickle_commitment_created'`
- `activity_category = 'event'`
- `source = 'prickle_commitments'`
- `related_id` = the commitment id
- `engagement_value = 3`
- `title`, e.g. "Committed to 3 prickles a week for 4 weeks"
- `data` = `{ start_date, weeks, slots: [{ type_id, day_of_week, start_time_local, timezone }] }`
- Under sudo, `actor_kind = 'staff'` and `actor_user_id` is the admin. Otherwise
  `actor_kind = 'member'`.

A failure here is logged and never fails the commitment itself. Cancellations aren't logged yet
(see open questions).

---

## Part 2: Proposal — commitment check-ins and check-outs

### What already exists (reuse, don't rebuild)

| Piece | Where | Notes |
|---|---|---|
| Notifications | `lib/notifications/` `createNotifier` | Honors each member's per-kind, per-channel settings (`notification_preferences`, `/settings/notifications`). Channels are Slack (via `sendSlackDM`, honoring `SLACK_TEST_MODE` / `SLACK_DEV_USER_ID`), in-app, and email (via `sendEmail`, honoring `EMAIL_TEST_MODE` / `EMAIL_DEV_ADDRESS`; opt-in for now). Commitment nudges should be new kinds here, not their own opt-out columns |
| Member → Slack user resolution | `lib/slack-member-ids.ts` `resolveSlackUserIds` | Matches by alias, then email, then normalized name |
| Check-in DM job | `app/api/internal/prickle-checkins/route.ts` | Polled every 5 min by **Supabase pg_cron + pg_net** (job `send-prickle-checkins`, `20261003130000_rename_nudges_to_prickle_checkins.sql`). Vercel Hobby cron is once a day only, so it can't do this. Auth via `CRON_INTERNAL_SECRET`. Goes to members with any active writing goal, for prickles on their calendar feed (hosting, an active commitment, or added by hand), using the feed's own loader (`loadCalendarFeedPrickleIds`). Asks the check-in's "coming in" questions (feelings, need) |
| Check-out DM | `sendCheckoutDMs` in `lib/prickle-checkin-dms.ts`, run by the same 5-minute cron as the check-ins. Live presence from the Zoom participant webhooks (`bronze.zoom_participant_events`, `lib/zoom-presence.ts`) makes it due 5 minutes after the prickle ends, or 10 minutes after an early leaver leaves; attendance (imported only after the Zoom meeting ends) is the backstop, up to 6 hours after the prickle | Asks how it went and how they feel now, then a static-select progress quick-log per goal. Handled in `app/api/webhooks/slack/interactions/route.ts`: check-in answers (`prickle_checkin_answer`) save to `prickle_checkins`, the same row as the prickle page's check-in; the quick-log (`writing_quick_log`) writes `writing_progress_entries` (with `prickle_id`) and a `member_activities` row |
| Dedup log | `prickle_checkin_dm_log`, UNIQUE `(prickle_id, member_id, kind)` | Insert-first, send only if the insert landed. Keyed on a `prickles.id` FK with `ON DELETE CASCADE`, so a calendar reprocess can wipe it and allow a resend |
| In-app progress logging | `components/writing/LogProgressModal.tsx` (accepts `prickleId`), `app/(member)/projects/` `logProgress` | |
| Email | **None for app messages.** Resend is only configured as Supabase Auth's SMTP (invites, magic links, in `supabase/config.toml`); React Email templates exist for those auth emails only | Sending app email would need a Resend API key and a sender module |
| In-app notifications | The "In the Hub" channel (`lib/channels/in-app.ts`, `in_app_notifications`): a bell in the member header, a `/notifications` inbox, and a banner while time-sensitive, sent through `createNotifier` like Slack. Behind the `in_app_notifications` flag | Check-ins and check-outs use it today |

### Channels, in recommended order

1. **Slack DM (v1)**: already wired and already used for exactly these two moments. Members live in
   Slack.
2. **In-app (v1, passive)**: a "Your next committed prickle" card on `/dashboard` and on the
   Commitments tab, plus a "How did it go?" card for any occurrence that's `kept` or `pending`
   with no follow-up recorded yet. Nothing is pushed, so there's nothing to opt out of. This also
   covers members we can't resolve to a Slack user.
3. **Email (later)**: only if Slack reach turns out to be poor. It needs a Resend API sender
   module, templates, and `List-Unsubscribe` handling. That's a separate project.

### Timing

- **Check-in**: about 20 minutes before (the existing 15–30 min window, every 5 min). If
  the member also has a matching writing goal, send one message, not two (see dedup below).
  Optional later: a "day-before" heads-up for the first week of a commitment only.
- **Check-out**: about 5 minutes after the prickle's scheduled end for everyone who was in the
  room, even if the Zoom meeting keeps going into the next prickle; about 10 minutes after an
  early leaver leaves, if they haven't rejoined. Both come from the Zoom participant webhooks. If
  those are lost, the attendance import when the meeting ends is the backstop. This is where
  `sendCheckoutDMs` already runs.
  - **Kept**: ask for progress (see [what to collect](#what-to-collect-post-prickle)).
  - **Missed**: send a gentle note the next day, from a daily sweep (the Vercel daily cron is
    fine). Only after the 24h grace period, never on the webhook, because attendance can lag and a
    false "we missed you" is worse than none. For example: "Missed you Monday — still on for next
    week?" with [Yes] [Pause this commitment] buttons.
- **End of commitment**: after the last occurrence, send a summary ("You made 3 of 4!") with a
  one-tap **Renew for N more weeks**. This is the biggest retention lever, and it's cheap: create a
  new row with `start_date` set to the next occurrence.

### Implementation sketch

**New route `app/api/internal/nudges/commitments/route.ts`.** Poll it from the existing pg_cron job,
either by adding a second `cron.schedule` or by folding it into the current route. On each tick:

1. Load active commitments where `end_date >= today - 1`. This set is small, but still paginate.
2. For prickles starting in the 15–30 minute window, match them to commitment occurrences
   (any slot) with `computeCommitmentProgress`, the same way `computeCommitmentSignals` in
   `lib/upcoming-prickles.ts` already does. That's the same matching the progress view uses, so
   "what we nudged about" and "what counts as kept" never disagree.
3. For each match, claim the send, then send the DM.

**Check-out.** Extend `sendCheckoutDMs`, or add a sibling that runs in the same
cron tick. Attendees with an active commitment covering this prickle get the commitment
follow-up.

**Idempotency: new table `commitment_nudge_log`.**

```sql
CREATE TABLE commitment_nudge_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commitment_id UUID NOT NULL REFERENCES prickle_commitments(id) ON DELETE CASCADE,
  slot_id UUID REFERENCES prickle_commitment_slots(id) ON DELETE CASCADE, -- null for per-commitment kinds (end_summary)
  occurrence_date DATE NOT NULL,          -- local date in the slot's timezone
  kind TEXT NOT NULL CHECK (kind IN ('pre_nudge', 'post_followup', 'missed_checkin', 'end_summary')),
  channel TEXT NOT NULL DEFAULT 'slack',
  prickle_id UUID,                        -- informational (prickle ids are stable; a FK would work too)
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (commitment_id, slot_id, occurrence_date, kind)
);
```

- Keyed on `(commitment_id, slot_id, occurrence_date, kind)`, **not** on `prickle_id`. That
  survives calendar reprocessing, which the existing `prickle_checkin_dm_log` doesn't. `slot_id` keeps
  two slots on the same date (e.g. a 5am and a 7pm) distinct.
- Use the same insert-first protocol as `tryRecordCheckinDM`: insert; treat a unique violation (`23505`)
  as "already sent"; send only if the insert landed. Service-role only (RLS on, no policies).
- **Cross-feature dedup.** Before sending a commitment pre-nudge, skip it if `prickle_checkin_dm_log`
  already has `prickle_checkin` for the same prickle and member, and have the writing-goal
  sender check the reverse. Simpler option: let the commitment nudge take precedence and have the
  writing-goal sender skip members with a matching active commitment.
- Record a send before calling Slack, so a failed Slack call means one missed nudge rather than
  duplicates. Accept that trade-off, and log the Slack error.

### Opt-out

- **Per commitment**: add a `nudges_enabled BOOLEAN NOT NULL DEFAULT true` column, set with a
  checkbox on the commitment form ("Remind me before each session"). Committing is itself the
  opt-in, so the default is on.
- **Global**: commitment nudges are notification kinds (`lib/notifications/registry.ts`), so
  members turn them off, or pick their channels, on `/settings/notifications` like any other
  notification. No separate preference column.
- **In the message**: every DM gets a "Stop these reminders" button, handled in
  `app/api/webhooks/slack/interactions/route.ts`. It sets `nudges_enabled = false` on that
  commitment. Pausing the commitment is a separate action from muting its reminders.
- Cancelled and completed commitments never nudge.

### What to collect post-prickle

Keep it to **one tap**, with an optional second step. For attended occurrences:

1. **Output**: the existing quick-log dropdown (words, minutes, or pages, picked by
   `pickQuickLogMeasure`). It writes `writing_progress_entries` with `prickle_id` set and mirrors to
   `member_activities`. If the member has no writing project, link to
   `/projects` → `LogProgressModal` with `prickleId` prefilled instead.
2. **Optional**: how it went and how they feel now. The check-out DM already asks both and saves
   them to the member's check-in (`prickle_checkins.session_rating` and `feelings_after`), so a
   per-commitment journal can read them from there by `prickle_id` rather than from a new table.
   A free-text "what did you work on?" would be a new `prickle_checkins` column.
3. **Missed weeks**: a single reason chip ("schedule conflict", "forgot", "not feeling it", "other")
   plus "still on for next week?". This is cheap, high-signal data for the product owner about
   *why* commitments break.

Attendance itself needs no collection; it's automatic. The follow-up only asks for what Zoom
can't see.

### Generalizing beyond commitments

Commitments are the explicit case. The same pipeline generalizes by swapping in an inferred
**intent source**:

- Define an interface: an intent source yields `(member_id, slot, confidence, source)` for an
  upcoming occurrence. Commitments yield confidence 1.0. A heuristic source yields "attended this
  slot 3 of the last 4 weeks" with confidence of about 0.75, using the same slot matching as
  `lib/commitments.ts` over `prickle_attendance`. Today `lib/prickle-checkin-dms.ts` takes its intent
  from the member's calendar feed (hosting, commitments, hand-added prickles), so it already
  consumes the explicit sources.
- Generalize the dedup log to `(member_id, occurrence_key, kind)`, where `occurrence_key` is
  `type:date:time`, so every source shares one "sent once per occurrence" guarantee.
- Heuristic nudges should be **opt-in** (or at least softer, with a lower frequency cap), since
  the member never asked. A natural bridge is a nudge like: "You've made Monday 7am three weeks
  running — want to commit to the next 4?" That turns inferred intent into an explicit commitment.
- Enforce frequency caps per member per day across all sources. This is easy once there's one log
  table.

---

## Part 3: Follow-up — commitments say which prickles, goals say how much

**Status:** proposed. Prerequisite done: goal anchors are gone (migration
`20261003120000_drop_writing_goal_anchors.sql`; no production goal had one).

### Why

A `measure='prickles'` goal used to have an optional anchor (one schedule's type + host +
weekday) that limited which prickles counted. That was a second, separate way to say "these are
my prickles", with its own picker, next to commitments. The two should be one concept:

- A **commitment** says *where and when I'll show up*: specific prickle slots, for a window. It
  drives the calendar feed, check-in DMs, and kept/missed tracking.
- A **goal** says *how much I want to do* on a writing project: words, chapters, scenes, minutes,
  or prickles attended. It drives progress, streaks and charts.

A prickles goal that should only count certain prickles links to a commitment, rather than
copying the slot details.

### Slots include the host

A commitment is to a specific prickle slot, e.g. "Monday 5am Progress Prickle with <host>", not
just type + weekday + time. Add `host_id` (FK `members`) to `prickle_commitment_slots`:

- Matching a prickle to a slot (`prickleMatchesSlot`, `assignOccurrencePrickles`) also requires
  `prickle.host = slot.host_id`.
- The slot picker already labels schedules with their host's name (`buildSlotOptions` over
  `prickle_schedules`); carry the schedule's host id through to the saved slot too.
- Unique key becomes `(commitment_id, type_id, host_id, day_of_week, start_time_local, timezone)`.
- **Host changes.** If the slot's host changes (a substitute, or a new regular host), the
  occurrence no longer matches. Show it as "no session with <host> this week", not "missed". For a
  permanent change, prompt the member to switch the slot to the new host or leave it.
- Existing rows: backfill `host_id` from the confirmed `prickle_schedules` row with the same
  type/weekday/time, if there is exactly one; otherwise leave it null and treat null as "any host"
  until the member edits it. Check how many production rows exist before choosing.

### Linking goals to commitments

- Add `writing_goals.commitment_id` (FK `prickle_commitments`, `ON DELETE SET NULL`), only valid
  for `measure='prickles'`. Null means "every writing prickle counts" (today's behavior).
- `derivePrickleHabitEntries` takes an optional set of slots; when the goal has a commitment, only
  attendance at prickles matching its slots counts (same matching as kept/missed).
- **Creating a commitment** ends with an optional step: "Track this on a writing project?" Pick a
  project (or create one) and a target, e.g. "3 prickles a week". That creates a linked prickles
  goal.
- **Creating a prickles goal** asks "Which prickles count?": *Any writing prickle*, one of the
  member's active commitments, or *Commit to specific prickles…*, which opens the commitment flow
  inline and links the result.
- Switching a goal to a different commitment archives the old goal row and inserts a new one, so
  an earned streak isn't recomputed against the new slots (see "Point-in-Time Goal Versioning" in
  `docs/TODO.md`).

### When a commitment ends: "Renew your commitment?"

Commitments are 1–12 weeks; goals can be open-ended. When a linked commitment's window ends:

- Send the end-of-commitment message from Part 2 as a Slack DM: the kept/missed summary, then
  **"Renew your commitment?"** with one-tap *Renew for N more weeks* (same slots, same length)
  and *Not now*. Renewing creates a new commitment and moves the linked goal to it, so the goal
  continues without a break.
- Show the same prompt on `/my-prickles` and on the goal card until the member answers.
- If they don't renew, the goal keeps counting nothing new from those slots. After a grace period
  (one week?), ask whether to switch the goal to "any writing prickle" or mark it done.

### Nudges

Nothing to change: check-in DMs already follow the calendar feed, which includes active
commitments. Once slots carry a host, the feed and check-ins become host-specific automatically
because they use the same matching.

### Rollout order

1. `host_id` on slots, with matching and picker changes. Commitments alone, no goal changes.
2. `writing_goals.commitment_id` and the goal-side picker.
3. "Track this on a writing project?" step in the commitment flow.
4. Renewal prompt (Slack DM + in-app), together with the Part 2 end-of-commitment summary.

---

## Open questions for the product owner

1. **Weeks range and default.** Is 1–12 with a default of 4 right? Should there be an "ongoing"
   option (no end date, a monthly check-in instead)?
2. **Partial cancel.** A multi-slot commitment is cancelled as a whole. Should members be able to
   drop one slot ("M/W/F → M/F") and keep the rest? Today they'd cancel it and commit to M/F
   again.
3. **What counts as kept?** Any attendance at all, or a minimum (e.g. ≥30 minutes, or joined within
   15 minutes of start)? The MVP counts any join.
4. **Host changes and substitutes.** *Answered:* commitments are to a specific slot including its
   host ("Monday 5am Progress Prickle with <host>"); see Part 3 for how host changes are handled.
5. **Canceled weeks.** When a slot doesn't run (holiday), should the commitment auto-extend by a
   week, or just show "no session"? The MVP shows "no session".
6. **Visibility.** Should commitments be visible to hosts ("5 Hedgies committed to your Monday
   7am") or to other members for accountability? This would need an RLS change; today only the
   member and admins can see them.
7. **Admin view.** Is an `/admin/commitments` list or a per-member panel needed? RLS already lets
   admins read everything, but there's no UI yet.
8. **Nudge channel and tone.** Slack DM first, is that agreed? Is a "missed you" message welcome, or
   too much pressure? What should the default nudge lead time be (20 minutes today)?
9. **Rewards.** Should kept commitments feed badges or streaks (`lib/badges.ts`, `lib/streaks.ts`),
   or engagement scoring beyond the +3 on creation? Should cancellations be logged as activity?
10. **Renewal.** *Partly answered:* a "Renew your commitment?" prompt at the end (Part 3). Should we
    also auto-renew by default with an opt-out?
