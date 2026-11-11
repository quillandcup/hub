# Conversations: tracking a community manager's ongoing reach-outs

The community manager reaches out to members (a hello, a check-in on their writing, a welcome back) and some of those turn into long conversations. She started with a spreadsheet, one row per message. This is the design for tracking it in the Hub instead: one record per **conversation**, status that follows from who spoke last, and outcomes measured against the member's own activity before and after.

Status: **step 1 built** (2026-11-11): write access, the `conversations` table, the repository and the page at `/admin/conversations`, with manual logging. The other steps are design; the build order is at the end, and what is left of each is in `docs/TODO.md`, "Conversations: what is left".

## Why not the spreadsheet, and why not Outreach

- **One row per message** hides the thing she asked for: how a conversation is going. The sheet's "one row per outreach, add a new row to contact them again" gives a history but no way to say "this is still the same conversation".
- **Most columns are derivable.** Date reached out, channel, whether and when they replied are facts the Hub can see. Typing them is the part that gets skipped when she is busy.
- **Outcomes need the member's record.** Whether a hedgie came to a prickle after a check-in is in `member_activities`; a sheet can't see it, and "Use Cody's tracker as the source of truth for member activity" means comparing by hand.
- **Outreach (`outreach_leads`, `outreach_touches`) is the wrong base.** It is about prospects, with a daily queue that only picks members with an Instagram handle. A touch stores who, whom and when, with no channel, note or outcome, and the community manager can't open `/admin/outreach`. What is worth copying is the pattern: each touch is also written to the member's timeline (`member_activities`).

Do not call these "check-ins": that name belongs to the prickle mood check-ins (`prickle_checkins`, `docs/CHECKINS.md`). The feature is **Conversations**; one is opened for a **reason** (a hello, a welcome, a writing check-in, encouragement).

## What the system fills in, and what only she knows

| Her column | Source |
|---|---|
| Hedgie / member | A member picker (`EntitySearch`), so it links to the record |
| Date reached out, how, response status, date they responded | **Derived** from messages (Slack DMs now; email later). Until a channel is connected she logs it by hand |
| Type of check-in (the reason) | Hers |
| Brief notes, follow-up date, next step | Hers |

**Status follows from who spoke last**, which also answers "last response date?":

| Status | Meaning |
|---|---|
| Needs your reply | the member wrote last |
| Waiting on them | she wrote last, within the quiet window |
| Gone quiet | nobody has written for longer than the quiet window |
| Closed | she closed it, with an outcome |

The quiet window is a config value, not a constant in code (`CLAUDE.md`, "No Hardcoded Config"). Start around 14 days and look at real conversations before settling.

## Data model

Local layer (operational data owned by this app, not reprocessed). Two tables, new prefixes per `CLAUDE.md` "New Tables and Ids": ids are text and server-made; the member id is `text REFERENCES members(id)`. These are Tier 2: **no id appears in a URL, link or export** (the conversation page is reached from the member or from the list by a path that does not carry a conversation id; decide when building whether a conversation needs a readable prefix first).

- **`conversations`**: `id`, `member_id`, `opened_by` (staff, uuid: it references auth), `reason` (check-in kind, a checked set), `channel` (`slack_dm`, `prickle`, `email`, `other`), `opened_at`, `closed_at`, `outcome` (null while open), `last_staff_message_at`, `last_member_message_at` (both null when nothing derived or logged), `follow_up_on` (date), `next_step`, `notes` (short, light: no sensitive detail; `deleted_at` soft delete, since a member's reach-out is a record of someone, `CLAUDE.md` soft delete rules). Partial unique index: one **open** conversation per member and channel, so a second hello continues the first.
- **`conversation_messages`** (added with the derived channels, not in the first build): one row per message's *metadata*: direction (`staff` or `member`), `sent_at`, channel, and the source key (Slack channel id and timestamp, or the Resend email id). **Never the text.** Slack text stays service-role-only (`docs/SLACK_BRIDGED_CHAT.md`); an email body is not copied into the Hub (`docs/EMAIL_TIMELINE.md`). Rebuildable from Bronze, so it follows the Silver rule: delete and re-derive, never an upsert that leaves orphans.

Audit: a conversation's own change is what the audit log records (opened, closed with an outcome, follow-up set), once, with before and after (`docs/ACTIVITY_AND_AUDIT_LOG.md`, "Record the intent, not the noise"). `last_*_message_at` and anything else that follows from messages go in the trigger's `WHEN` exclusions, so a re-derivation writes no audit rows. Opening and closing also write a `member_activities` row (`source = 'conversations'`, `actor_kind = 'staff'`, `engagement_value = 0`) so the member's timeline shows it, like outreach touches do.

**Access.** Reads and writes are for admins and, for the first time, the community manager. That needs what `docs/TODO.md` ("Community manager: narrower billing reads, Activity Log, and the write page") already lists: `requireStaffAction()` beside `requireAdminAction()` in `lib/admin-auth.ts`, a page in `isCommunityManagerPath` (`lib/staff-access.ts`) that starts with `requireStaffPage()`, and RLS policies using `is_community_manager()`, never a widened `is_admin()`. Her write controls are an opt-in staff feature (`STAFF_FEATURES`), so a new button stays hidden from any future role until granted. Every server action is wrapped in `withAction` and the page gets events in the tracking plan (`docs/ANALYTICS.md`).

The data access follows the repository rule: `ConversationRepository` (`lib/data/conversations.ts`) with a Supabase class, an in-memory twin and one contract suite, and the table registered in the guard test.

## Slack DMs fill it in

The Slack DM bridge already pulls 1:1 and group DMs each night using a member's own Slack token (`lib/chat/slack-dms.ts`, `/api/reconcile/slack-dms`; `docs/SLACK_BRIDGED_CHAT.md`, "Slack 1:1 DMs through members' own tokens"). The bot cannot be in a 1:1 DM, which is why it is the member's token. If she connects her Slack and `slack_dm_bridge` is on for her, every DM between her and a member reaches Bronze.

The projection reads Bronze with the service role and writes only metadata (who sent, when) into `conversation_messages`, then sets the last-spoke timestamps. A DM to a member who has not connected Slack is still captured, because one side of the conversation did. A reach-out she makes in a prickle or by phone is logged by hand.

Open questions for her before turning it on: she must be comfortable connecting her own Slack to the Hub for this, and the bridge reads **all** her DMs, not only with members. The privacy page and a consent step should say that plainly (`CLAUDE.md`: staff DMs are restricted; admins read them only through break-glass, and this feature does not change that).

## Email

Resend can receive mail (`email.received`; the webhook has metadata only, the body comes from `resend.emails.receiving.get`; the list endpoint `GET /emails/receiving` gives the pull-based path the "nothing through webhooks alone" rule requires). Setup is the "Replies (phase 2)" item in `docs/TODO.md`, "Email timeline: what is left":

- Her own address on a subdomain whose MX points at Resend (`hub.` is a CNAME to Vercel, so it can't carry the MX; use the `reply.` subdomain already planned).
- Incoming: the webhook stores the metadata, the nightly pull recovers what it missed, and the message is forwarded to her inbox so she reads and answers it in her mail app.
- Outgoing: her mail app's "send as" through Resend SMTP, so her replies are in `bronze.resend_events` and the timeline. **To verify first:** that SMTP sends fire the same webhooks as API sends, and that the member is matched by address (Supabase Auth's emails go over SMTP and match by address only, with no tags, `docs/EMAIL_TIMELINE.md`).
- A BCC habit is the fallback, not the design: it depends on her remembering.

Adding an address to the `support@` Google Group would capture support mail, not her one-to-one conversations; keep them separate.

## Measuring her influence

Each conversation is compared with the member's own activity (`member_activities`, `get_activity_feed` is admin-only, so build the read as a repository method over the `(member_id, occurred_at DESC)` index with both a start and an end date). No snapshots are stored: any window can be recomputed for any date.

Windows, counted from the conversation's `opened_at` (the numbers are config, not fixed):

1. **Before:** the 28 days before.
2. **Right after:** days 0 to 14.
3. **Did it last:** days 30 to 60 after it closed.

For each, show the parts, not only the score. `engagement_score` is capped at 100 over 30 days and hides what changed (`lib/member-engagement.ts`): prickles attended, Slack messages, and firsts (first prickle, first post).

**Connected to other people** is the test for "did it stick": the number of **distinct members** they interacted with other than staff (`member_interactions`: DMs, thread replies, mentions, reactions) and the distinct people they attended prickles with. If these rise after, the outreach opened a door; if only their contact with her rises, it did not outlast her.

**Honest limits**
- Some quiet members come back unprompted. A fair comparison is a group of similar at-risk members she has not contacted yet. If she picks her weekly list at random from the at-risk list, that group exists without leaving anyone out for good.
- At about 10 a week the totals stay small for months. Read individual before-and-after stories now and cohort numbers each quarter.
- Don't derive "who counts as at-risk" or "returned" from a guess: take it from membership history and the data (`CLAUDE.md`, "Business Facts: Derive, Don't Assume").

Outcomes show on each conversation and as a cohort view on `/admin/at-risk`, which is already her home page.

## Build order

1. **Write access and the Conversations page.** `requireStaffAction()`, the `conversations` table with grants, RLS and audit, the repository, the page (list and detail), manual logging, tracking-plan events, and an import of her current sheet (run locally, deleted afterwards: member names stay out of the repo, `.claude/rules/public-repo-hygiene.md`). This alone replaces the spreadsheet.
2. **Slack DMs fill status in**, with consent.
3. **Outcomes**: the windows, the connections measure and the cohort view.
4. **Email** through Resend, as above.

Deferred pieces are entries in `docs/TODO.md` ("Conversations: what is left").

### What step 1 does

- **Table:** `conversations` (`20270624000000_conversations.sql`, id prefix `conv_`), as in "Data model" above, plus a check that `closed_at` and `outcome` are set together. Reasons: hello, welcome, check_in, writing_check_in, encouragement, other. Channels: slack_dm, prickle, email, other. Outcomes: re_engaged, no_response, declined, resolved, other. Notes are capped at 1000 characters and the next step at 280 (CHECK constraints, mirrored in `lib/conversations.ts`).
- **Access:** RLS lets `is_admin()` or `is_community_manager()` read, insert (as themselves: `opened_by` must be the caller) and update; there is no DELETE grant, a removed conversation has `deleted_at`. The page and its actions are open to her through `requireStaffPage()` / `requireStaffAction()` and the `conversations.write` staff feature (granted to her, which every admin has); a future staff role gets neither the page nor the feature until added.
- **Status:** `conversationStatus()` in `lib/conversations.ts`, from the last-message times. The member wrote last: needs your reply (however long ago). She wrote last or opened it: waiting on them until `conversationQuietDays` (`app.config.ts`, 14) days pass with nothing from either side, then gone quiet. A conversation with nothing logged counts from when it was opened. Opening one records her message at that moment, unless "they wrote to me first" is ticked.
- **Audit:** the `conversation` entity is audited by three triggers; the update one leaves out `updated_at`, `last_staff_message_at` and `last_member_message_at`, so logging a reply writes no row. `audit_row_change()` now counts a community manager as staff (it listed only admin and assistant).
- **Timeline:** opening and closing write a `member_activities` row (source `conversations`, actor staff, engagement 0, `related_id` the conversation) from the server action, best effort, with the reason and channel and, on a close, the outcome. Never her notes. RLS gives a community manager an INSERT on `member_activities` for that source, as herself, and nothing else.
- **Removal request:** `member_data_handling` says `conversations.member_id` is deleted with the member.

