# Hedgie Care: tracking a community manager's reach-outs

The community manager reaches out to members (an introduction, a check-in on their writing, a welcome back) and some of those turn into long conversations. She started with a spreadsheet, one row per message. **Hedgie Care** tracks it in the Hub instead: one record per **engagement** (one reach-out period with one member), a status that follows from the dates and who spoke last, and results measured against the member's own activity before, during and after.

Status: **built** (2026-11-11): write access, the `care_engagements` table, the repository, the measured results and the page at `/admin/care`, with manual logging. Slack DMs and email filling in the messages, the cohort comparison and the import of her sheet are design and are in `docs/TODO.md`, "Hedgie Care: what is left". It replaced a first build called Conversations (one open-ended row per member and channel), which was never announced and had no rows.

## Why not the spreadsheet, and why not Outreach

- **One row per message** hides the thing she asked for: how a reach-out is going. "Add a new row to contact them again" gives a history but no way to say "this is still the same engagement".
- **Most columns are derivable.** Date reached out, channel, whether and when they replied are facts the Hub can see. Typing them is the part that gets skipped when she is busy.
- **Outcomes need the member's record.** Whether a hedgie came to a prickle after a check-in is in `member_activities`; a sheet can't see it.
- **Outreach (`outreach_leads`, `outreach_touches`) is the wrong base.** It is about prospects, with a daily queue that only picks members with an Instagram handle, and the community manager can't open `/admin/outreach`. What is worth copying is the pattern: each event is also written to the member's timeline (`member_activities`).

Do not call these "check-ins": that name belongs to the prickle mood check-ins (`prickle_checkins`, `docs/CHECKINS.md`). The program is **Hedgie Care**; the unit on the page is an **engagement**; one is started for a **reason**.

### Next to the Big Sister program, and the work queue

Hedgie Care is a **sibling of the Big Sister program** (`docs/BIG_SISTERS.md`: every new member is matched with a big sister for 30 days). The same person is likely responsible for both. "Welcome" (and "introduction") is a reason here **on purpose**, so a welcome she sends is tracked the same way as any other reach-out; it overlaps what a big sister does and the two are not tied together. The admin work queue's hiatus nudges and welcome-back suggestions (`/admin/work-queue`) also overlap, and are left as they are: they say who might need a message, Hedgie Care records that she sent one.

## What the system fills in, and what only she knows

| Her column | Source |
|---|---|
| Hedgie / member | A member picker (`EntitySearch`), so it links to the record |
| Date reached out, how, response status, date they responded | **Derived** from messages (Slack DMs and email, later). Until a channel is connected she logs it by hand ("They replied", "I replied") |
| Type of check-in (the reason) | Hers: Introduction, Welcome, A check-in, A writing check-in, Encouragement, Something else (her sheet's own dropdown, with Welcome and Introduction kept apart) |
| Brief notes, follow-up date, next step | Hers |
| How it ended | Hers: a short list of endings, her own subjective read (`CARE_ENDED_HOW` in `lib/care-values.ts`, and the `ended_how` check in the migration: the only two places) |

## An engagement is a period

One row is one **engagement period**. It has an end date, and when the period is over she **renews** it (a new row that links back to the one before, `renewed_from`) or **closes** it with how it ended. A long relationship is a chain of periods, each with its own start, its own end and its own measured results, so "did the 30 days work" has an answer per period.

- **Length is config, not code:** `careEngagementDays` in `app.config.ts` (read through `lib/config.ts`). It starts at **30; the community manager should confirm it.**
- **The period's last day is an organization-timezone (Eastern) calendar date:** the day `careEngagementDays` days after the one it opened on, computed with calendar arithmetic (`periodEndsOn`, `lib/care.ts`), so neither a daylight saving change nor an evening opening (already tomorrow in UTC) can move it. The period runs through the whole of that day. Tests cover both sides of an Eastern midnight and both clock-change days.
- **One open engagement per member and channel** (a partial unique index), so a second hello continues the first.

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

**Active** = open and not lapsed. The page has two tabs, which are paths (`CLAUDE.md`, "Tabbed Pages"): `/admin/care` (Active: needs reply, review due, gone quiet, waiting) and `/admin/care/earlier` (closed and lapsed, most recently ended first, paged). Actions: **Renew** (closes this period as renewed and opens the next in one step: `renew_care_engagement`, a database function, safe against a double click because the close is conditional on the engagement still being open), **Close** with how it ended (every ending except "renewed", which only Renew sets), log a message, set a follow-up day, edit, remove (soft delete).

## Data model

Local layer (operational data owned by this app, not reprocessed). Ids are text and server-made (`care_` prefix); the member id is `text REFERENCES members(id)`. This is Tier 2: **no id appears in a URL, link or export** (the page never links by engagement id).

- **`care_engagements`** (`20270626000000_hedgie_care.sql`): `id`, `member_id`, `opened_by` (staff, uuid: it references auth), `reason`, `channel` (`slack_dm`, `prickle`, `email`, `other`), `opened_at`, `period_ends_on` (date), `renewed_from` (the engagement this one continues), `closed_at`, `ended_how` (null while open, set with `closed_at`: a CHECK keeps the two together), `last_staff_message_at`, `last_member_message_at` (both null when nothing is derived or logged), `follow_up_on`, `next_step` (at most 280 characters), `notes` (at most 1000, short and light: no sensitive detail), `deleted_at` (soft delete: a member's reach-out is a record of someone), `created_at`, `updated_at`. Reasons, channels and endings are checked sets; the sets live in `lib/care-values.ts` and the migration only.
- **`conversation_messages`** (added with the derived channels, not built): one row per message's *metadata*: direction (`staff` or `member`), `sent_at`, channel and the source key. **Never the text.** Slack text stays service-role-only (`docs/SLACK_BRIDGED_CHAT.md`); an email body is not copied into the Hub (`docs/EMAIL_TIMELINE.md`). Rebuildable from Bronze, so it follows the Silver rule: delete and re-derive.

**Access.** Reads and writes are for admins and the community manager: `requireStaffAction()` beside `requireAdminAction()` (`lib/admin-auth.ts`), the routes in `isCommunityManagerPath` (`lib/staff-access.ts`) starting with `requireStaffPage()`, and RLS with `is_community_manager()`, never a widened `is_admin()`. RLS lets staff read, insert (with `opened_by` forced to the caller) and update; there is **no DELETE grant** and no `anon` grant. Her write controls are the opt-in staff feature **`care.write`** (`STAFF_FEATURES`), granted to her (every admin has every feature); a future staff role gets neither the page nor the feature until added. Every action is wrapped in `withAction`.

**Audit.** The `care_engagement` entity is audited by three triggers; the update one leaves out `updated_at`, `last_staff_message_at` and `last_member_message_at`, so logging a reply writes no row. `audit_row_change()` counts a community manager as staff (changed in the first build). A renewal is two entries by nature (the old period closed as "renewed", the new one inserted with `renewed_from`).

**Timeline.** Starting, renewing and closing write a `member_activities` row (source `care`, types `care_started`, `care_renewed`, `care_closed`, actor staff, engagement 0, `related_id` the engagement) from the server action, best effort, with the reason, channel and, on a close, how it ended. Never her notes. RLS gives a community manager an INSERT on `member_activities` for that source, as herself, and nothing else.

**Removal request.** `member_data_handling` says `care_engagements.member_id` is deleted with the member. A member merge drops the duplicate's engagements for now (`NOT_MOVED`, `lib/member-merge-coverage.ts`; `docs/TODO.md`).

The repository is `CareRepository` (`lib/data/care.ts`) with a Supabase class, an in-memory twin and one contract suite, and the table is registered in the guard test.

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
- **People connected**: the distinct members they interacted with (`member_interactions`: DMs, thread replies, mentions, reactions, in either direction), **not counting staff**: every member who is in the `staff` table, and the person who opened the engagement (she is paid in comps and may not be in `staff`). If it rises after, the outreach opened a door; if only their contact with her rises, it did not outlast her.

The reads are repository methods with both a start and an end date, paginated past 1000 rows with a stable order: `ActivityRepository.countsBetween` and `firsts` (`lib/data/activities.ts`) and the new `MemberInteractionRepository.counterpartsBetween` (`lib/data/member-interactions.ts`; nothing owned `member_interactions` before: the member network page reads it through an RPC). `member_interactions` was admin-only, so the migration gives the community manager a **read-only** `is_community_manager()` SELECT policy on it. It holds who interacted with whom, when and whether in the open or in private (DMs and private channels included), never what was said; she sees only counts on this page, but the policy lets her read the rows.

**Honest limits** (also on the panel)
- Some quiet members come back unprompted. A fair comparison is a group of similar at-risk members she has not contacted; that cohort view is not built (`docs/TODO.md`).
- At about 10 a week the totals stay small for months. Read individual before-and-after stories now and cohort numbers each quarter.
- Slack messages and people connected exist only as far back as the Hub's own records (the Slack activity mirror, the chat mirror behind `member_interactions`), so a "before" window early in that history can read low and a "first" can be the first the Hub knows of.
- Don't derive "who counts as at-risk" or "returned" from a guess: take it from membership history and the data (`CLAUDE.md`, "Business Facts: Derive, Don't Assume").

## Slack DMs fill it in (not built)

The Slack DM bridge already pulls 1:1 and group DMs each night using a member's own Slack token (`lib/chat/slack-dms.ts`, `/api/reconcile/slack-dms`; `docs/SLACK_BRIDGED_CHAT.md`, "Slack 1:1 DMs through members' own tokens"). The bot cannot be in a 1:1 DM, which is why it is the member's token. If she connects her Slack and `slack_dm_bridge` is on for her, every DM between her and a member reaches Bronze.

The decided design (details in `docs/TODO.md`): a DM is tracked **per DM, as an opt-in**. A staff member's DMs with another staff member are excluded automatically, since the counterpart is in `staff`; a member's DM becomes tracked when she starts an engagement on "Slack DM" with them, or by a per-DM toggle. Group DMs are out of the first version. The projection reads Bronze with the service role and writes only metadata (who sent, when) into `conversation_messages`, then sets the last-spoke timestamps. **One fact stays open:** the pull reads **all** of a connected member's 1:1 and group DMs, so the opt-in limits what the tracker shows, not what is pulled. The privacy page and a consent step should say that plainly (staff DMs are restricted; admins read them only through break-glass, and this feature does not change that).

## Email (not built)

Resend can receive mail (`email.received`; the webhook has metadata only, the body comes from `resend.emails.receiving.get`; the list endpoint `GET /emails/receiving` gives the pull-based path the "nothing through webhooks alone" rule requires). Setup is the "Replies (phase 2)" item in `docs/TODO.md`, "Email timeline: what is left":

- Her own address on a subdomain whose MX points at Resend (`hub.` is a CNAME to Vercel, so it can't carry the MX; use the `reply.` subdomain already planned).
- Incoming: the webhook stores the metadata, the nightly pull recovers what it missed, and the message is forwarded to her inbox so she reads and answers it in her mail app.
- Outgoing: her mail app's "send as" through Resend SMTP, so her replies are in `bronze.resend_events` and the timeline. **To verify first:** that SMTP sends fire the same webhooks as API sends, and that the member is matched by address.
- A BCC habit is the fallback, not the design: it depends on her remembering.

## Build order

1. **Write access, the table, the page and the measured results** (built).
2. **Slack DMs fill status in**, with consent and the per-DM opt-in above.
3. **The cohort view**: a comparison group on `/admin/at-risk`, which is already her home page.
4. **Email** through Resend, as above.

Deferred pieces are entries in `docs/TODO.md` ("Hedgie Care: what is left"): her sheet's import (a local one-off, never committed: member names stay out of the repo), a section on the member's profile, member-merge handling and a funnel for the events.

## Decisions to confirm with her

`careEngagementDays` (30), `careLapseGraceDays` (14) and `careQuietDays` (14) are starting points. So are the list of reasons, the list of endings and the three windows. All are one edit: `app.config.ts` for the numbers, `lib/care-values.ts` and the migration's `CHECK` for the lists.
