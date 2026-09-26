# Commitments

A **commitment** is a member's promise to attend one recurring prickle slot for a set number of
weeks: "Mondays 7am Progress Prickle for the next 4 weeks." It's the attendee-side sibling of
Hosting (`prickle_schedules`): Hosting is "I'll run this slot", a commitment is "I'll show up to
this slot."

Commitments give us an explicit, opt-in signal of intent. That's the anchor for **pre-prickle
nudges** and **post-prickle follow-ups**. We build those on top of commitments first, and only
later try to infer intent heuristically for members who never commit (see
[Generalizing beyond commitments](#generalizing-beyond-commitments)).

Status: the MVP (data model, member UI, progress tracking) is built. Nudges and follow-ups are
**proposed only** (this doc).

---

## Part 1: What's built

### Data model: `prickle_commitments`

Migration: `supabase/migrations/20260926000200_create_prickle_commitments.sql`. This is **Local layer**
data: members own it, it uses normal CRUD, and it's never reprocessed.

| Column | Notes |
|---|---|
| `id` | uuid PK |
| `member_id` | FK `members`, `ON DELETE CASCADE` |
| `type_id` | FK `prickle_types`, `ON DELETE CASCADE` |
| `day_of_week` | 0=Sun..6=Sat, same convention as `prickle_schedules.day_of_week` |
| `start_time_local` | `TIME`, wall-clock time in `timezone` |
| `timezone` | IANA tz the member saw the schedule in (their preference, or `America/New_York` when set to "browser") |
| `start_date` | first occurrence is the first `day_of_week` on/after this date |
| `weeks` | 1–12, default 4 |
| `end_date` | **generated**: `start_date + weeks*7 - 1` (for window queries and future cron jobs) |
| `status` | `active` / `completed` / `cancelled` |
| `cancelled_at` | set iff `status = 'cancelled'` (CHECK constraint) |
| `created_by` | the real auth user (an admin, under sudo) |
| `created_at`, `updated_at` | |

Design choices:

- **Slot identity matches Hosting.** A slot is type + weekday + local time + timezone. There's no
  FK to `prickles(id)`, because prickles are DELETE+INSERT reprocessed from the calendar and their
  ids aren't stable. (The existing `writing_nudge_log` does reference `prickles(id)` with `ON DELETE
  CASCADE`, so a calendar reprocess silently erases its dedup rows. We shouldn't copy that. See
  below.)
- **One active commitment per member per slot.** A partial unique index on
  `(member_id, type_id, day_of_week, start_time_local, timezone) WHERE status = 'active'` enforces
  this. The server action checks first so it can show a friendly error.
- **`completed` is lazy.** `getMyCommitments` flips `active` rows whose window has passed to
  `completed` (best-effort). Status is also derived on read (`effectiveCommitmentStatus`), so a
  stale `active` row is harmless. A future nudge cron should filter on `end_date` rather than trust
  `status` alone.
- **Cancel, never delete.** There's no DELETE policy. History stays intact, and so will future
  nudge logs.
- **RLS:** members can SELECT/INSERT/UPDATE their own rows. Rows are matched by
  `members.email = auth.email()`, the same approach as `prickle_schedules`, because
  `members.user_id` isn't populated. Admins (`is_admin()`) can read everything and can also write,
  which covers sudo: a sudo'd write runs under the real admin's session.

### Member UI

- **`/my-prickles?tab=commitments`**: a new "Commitments" tab (`CommitmentsManager.tsx`):
  - A form to pick a slot, choose 1–12 weeks (default 4) and a start date. The start date
    defaults to the slot's next occurrence. A preview shows the window, e.g. "4 sessions:
    Mon, Sep 28 – Mon, Oct 19".
  - Slot options come from `getPrickleScheduleOverview` rows (`buildSlotOptions`), the same
    recurring schedule the All Prickles tab shows, so members can only pick slots that exist.
    `createCommitment` re-checks this server-side against real prickles in the next 21 days.
  - "Active commitments" and "Past commitments" lists. Each shows a progress summary ("2 kept ·
    1 missed · 1 to go") and one dot per week (kept, missed, pending, upcoming, or no session).
    Cancelling an active commitment takes a two-step confirm.
- **All Prickles table**: each row now has a "Commit" link to
  `/my-prickles?tab=commitments&slot=<seriesKey>`, which preselects that slot.

### Progress: kept vs. missed (`lib/commitments.ts`, pure)

For each of the commitment's `weeks` occurrence dates:

1. **Expected start**: `start_time_local` on that date in the commitment's `timezone`, converted to
   UTC. This is DST-aware (`zonedTimeToUtc`).
2. **Match a prickle**: find the same-type prickle closest to the expected start, within
   **±60 minutes**. The tolerance covers weeks when the member's timezone and the org's (ET) switch
   DST on different dates. For example, a London member's "12:00" is 7am ET for most of the year,
   but for one week in spring and one in fall the ET prickle lands an hour off. Because the closest
   prickle wins, an adjacent-hour slot of the same type only matches when the committed slot didn't
   run that week.
3. **Classify the week**:
   - `kept`: the member has any `prickle_attendance` row for the matched prickle. Multiple
     join/leave rows collapse to one, since the check uses a set of distinct prickle ids.
   - `upcoming`: the prickle hasn't started. Future weeks never count.
   - `pending`: the prickle ran, there's no attendance yet, and it ended less than 24h ago.
     Attendance is imported on the Zoom `meeting.ended` webhook and by the nightly reconcile, so it
     can lag.
   - `missed`: the prickle ran, there's no attendance, and the 24h grace period is over.
   - `no_session`: no matching prickle ran that week (a holiday, or a cancelled calendar event).
     This isn't held against the member.
   - After a cancellation, later weeks are dropped rather than counted as missed.

Data fetching happens in `getMyCommitments`
(`app/(member)/my-prickles/commitment-actions.ts`):

- One query for the member's commitments.
- One paginated query for prickles of the relevant types across the union window
  (`commitmentsFetchWindow`).
- The member's `prickle_attendance` for those prickle ids, fetched in batches of 100 ids with
  each batch paginated.

### Activity log

Creating a commitment writes a best-effort, append-only `member_activities` row, following the
same pattern as writing progress and outreach touches (`docs/ACTIVITY_AND_AUDIT_LOG.md`):

- `activity_type = 'prickle_commitment_created'`
- `activity_category = 'event'`
- `source = 'prickle_commitments'`
- `related_id` = the commitment id
- `engagement_value = 3`
- `data` holds the slot and window
- Under sudo, `actor_kind = 'staff'` and `actor_user_id` is the admin. Otherwise
  `actor_kind = 'member'`.

A failure here is logged and never fails the commitment itself. Cancellations aren't logged yet
(see open questions).

---

## Part 2: Proposal — pre-prickle nudges and post-prickle follow-ups

### What already exists (reuse, don't rebuild)

| Piece | Where | Notes |
|---|---|---|
| Slack DM sender | `lib/slack.ts` `sendSlackDM` | Honors `SLACK_TEST_MODE` / `SLACK_DEV_USER_ID` |
| Member → Slack user resolution | `lib/writing-nudges.ts` `resolveSlackUserIds` | Matches by alias, then email, then normalized name |
| Pre-prickle nudge job | `app/api/internal/nudges/pre-prickle/route.ts` | Polled every 5 min by **Supabase pg_cron + pg_net** (`20260831170001_enable_pg_cron_pre_prickle_nudges.sql`). Vercel Hobby cron is once a day only, so it can't do this. Auth via `CRON_INTERNAL_SECRET`. Currently gated on writing goals with `measure='prickles'` |
| Post-prickle prompt | `sendPostPricklePrompts` in `lib/writing-nudges.ts`, fired from the Zoom `meeting.ended` webhook after attendance import | Slack static-select quick-log. Handled in `app/api/webhooks/slack/interactions/route.ts` (`writing_quick_log`), which writes `writing_progress_entries` (with `prickle_id`) and a `member_activities` row |
| Dedup log | `writing_nudge_log`, UNIQUE `(prickle_id, member_id, kind)` | Insert-first, send only if the insert landed. Keyed on a `prickles.id` FK with `ON DELETE CASCADE`, so a calendar reprocess can wipe it and allow a resend |
| In-app progress logging | `components/writing/LogProgressModal.tsx` (accepts `prickleId`), `app/(member)/projects/` `logProgress` | |
| Email | **None for app messages.** Resend is only configured as Supabase Auth's SMTP (invites, magic links, in `supabase/config.toml`); React Email templates exist for those auth emails only | Sending app email would need a Resend API key and a sender module |
| In-app notifications | **None.** There's no notifications table or inbox UI. The only banners are `SudoBanner` and `ConsentBanner` | |

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

- **Pre-prickle nudge**: about 20 minutes before (the existing 15–30 min window, every 5 min). If
  the member also has a matching writing goal, send one message, not two (see dedup below).
  Optional later: a "day-before" heads-up for the first week of a commitment only.
- **Post-prickle follow-up**: after attendance import (Zoom `meeting.ended` → import resolved). This
  is where `sendPostPricklePrompts` already runs.
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
2. For prickles starting in the 15–30 minute window, match them to commitments using
   `matchOccurrencePrickle` / `expectedOccurrenceStart`. That's the same logic the progress view
   uses, so "what we nudged about" and "what counts as kept" never disagree.
3. For each match, claim the send, then send the DM.

**Post-prickle.** Extend `sendPostPricklePrompts`, or add a sibling that's called from the same
webhook branch. Attendees with an active commitment covering this prickle get the commitment
follow-up.

**Idempotency: new table `commitment_nudge_log`.**

```sql
CREATE TABLE commitment_nudge_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commitment_id UUID NOT NULL REFERENCES prickle_commitments(id) ON DELETE CASCADE,
  occurrence_date DATE NOT NULL,          -- local date in the commitment's timezone
  kind TEXT NOT NULL CHECK (kind IN ('pre_nudge', 'post_followup', 'missed_checkin', 'end_summary')),
  channel TEXT NOT NULL DEFAULT 'slack',
  prickle_id UUID,                        -- informational only, no FK (prickle ids aren't stable)
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (commitment_id, occurrence_date, kind)
);
```

- Keyed on `(commitment_id, occurrence_date, kind)`, **not** on `prickle_id`. That survives
  calendar reprocessing, which the existing `writing_nudge_log` doesn't.
- Use the same insert-first protocol as `tryRecordNudge`: insert; treat a unique violation (`23505`)
  as "already sent"; send only if the insert landed. Service-role only (RLS on, no policies).
- **Cross-feature dedup.** Before sending a commitment pre-nudge, skip it if `writing_nudge_log`
  already has `pre_prickle_nudge` for the same prickle and member, and have the writing-goal
  sender check the reverse. Simpler option: let the commitment nudge take precedence and have the
  writing-goal sender skip members with a matching active commitment.
- Record a send before calling Slack, so a failed Slack call means one missed nudge rather than
  duplicates. Accept that trade-off, and log the Slack error.

### Opt-out

- **Per commitment**: add a `nudges_enabled BOOLEAN NOT NULL DEFAULT true` column, set with a
  checkbox on the commitment form ("Remind me before each session"). Committing is itself the
  opt-in, so the default is on.
- **Global**: a `user_profiles.commitment_nudges` preference, `'slack' | 'off'`, later adding
  `'email'`. Show it on `/settings` next to the timezone preference.
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
2. **Optional**: a 1–5 "how focused were you?" (or 🔥/🙂/😐) and a free-text "what did you work
   on?". Store these in a new `commitment_checkins` table
   `(commitment_id, occurrence_date, prickle_id, focus_rating, note, created_at)`, or as `data` on a
   `member_activities` row of type `prickle_commitment_checkin`. The table is better if we want to
   show a per-commitment journal.
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
  `lib/commitments.ts` over `prickle_attendance`. Writing goals with an anchor are a third source,
  which means the existing `lib/writing-nudges.ts` becomes one implementation.
- Generalize the dedup log to `(member_id, occurrence_key, kind)`, where `occurrence_key` is
  `type:date:time`, so every source shares one "sent once per occurrence" guarantee.
- Heuristic nudges should be **opt-in** (or at least softer, with a lower frequency cap), since
  the member never asked. A natural bridge is a nudge like: "You've made Monday 7am three weeks
  running — want to commit to the next 4?" That turns inferred intent into an explicit commitment.
- Enforce frequency caps per member per day across all sources. This is easy once there's one log
  table.

---

## Open questions for the product owner

1. **Weeks range and default.** Is 1–12 with a default of 4 right? Should there be an "ongoing"
   option (no end date, a monthly check-in instead)?
2. **Scope of a commitment.** Is it one slot for N weeks, or should a member be able to commit to
   several slots in one go ("Mon + Thu for 4 weeks")? The MVP needs one commitment per slot.
3. **What counts as kept?** Any attendance at all, or a minimum (e.g. ≥30 minutes, or joined within
   15 minutes of start)? The MVP counts any join.
4. **Host changes and substitutes.** Commitments are to a slot, not a host. If the host changes,
   the commitment still applies. Is that right, or do some members commit to a specific host?
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
10. **Renewal.** One-tap renew at the end is proposed. Should we also auto-renew by default with an
    opt-out?
