# Slack-Bridged Chat: Design

Status: **design agreed; groundwork, the chat_* mirror, the read-only chat UI, search, Realtime and unread state are built; the two-way bridge (phase 3) is next.** Written 2026-09-29 from a design walkthrough. Member-facing summary of the privacy model: `app/(member)/privacy/page.tsx` (behind the `message_privacy` flag until everything it says is true).

## Goals

- Chat in the Hub that mirrors our Slack channels: a message typed in either place shows up in both.
- Room to migrate: app-only channels alongside bridged ones, and Slack-only channels (anything the bot isn't in) left alone. Moving a channel off Slack is a per-channel switch.
- DMs and group DMs in the Hub. Slack 1:1 DMs between people are never bridged (the bot can't be in them); Slack group DMs are bridged once someone adds the bot.
- **The Hub is the permanent archive.** Slack's plan limits how much history Slack shows; the Hub keeps everything, so search is a first-class feature, not an add-on.
- Chat activity (including private channels and DMs) feeds engagement and the member network graph as **metadata**, never content.

**Not in scope now:** forum-style topic posts (title + long body) — explore later as an app-only channel type. Notifications are a separate framework (`docs/TODO.md` → Notifications) that chat will plug into.

## Decisions

| Topic | Decision |
|---|---|
| Where chat lives | Local layer (`chat_*` tables). Slack-origin rows are projected from Bronze by one shared function; app-origin rows are written by the app. |
| Which Slack conversations are bridged | Every conversation Billie Bot is in: public channels, private channels, and group DMs (members can add the bot to a group DM, and Wheel of Wonder rooms are group DMs the bot opens). Unless marked `bridge_disabled`. Anything the bot isn't in stays Slack-only. |
| Slack group DMs | Bridged as `group_dm`, always `restricted` (content needs break-glass, metadata visible), and counted toward engagement and the network graph. Slack can't add people to an existing group DM, so their membership is read-only in the Hub. |
| Membership | `chat_channel_members` for **all** channels = "subscribed" (sidebar, feed, notifications, read state). Mirrors Slack membership, public channels included. Required for access only on private channels and DMs. |
| Adding/removing people in the app | Propagates to Slack (`conversations.invite` / `conversations.kick` by the bot). |
| How app posts appear in Slack | Member's own Slack token if they connected Slack (native); otherwise the bot posts with the member's name and avatar (`chat:write.customize`). |
| Privacy boundary | **Content vs. metadata**, not per table. Content = message text, blocks, files, raw payloads. Metadata = who, where, when, how often, membership, reactions, directories. |
| Admin access to content | Public channels and private channels with the bot: readable. Channels flagged `restricted`, DMs and group DMs: break-glass only. |
| Break-glass | Reason required, scoped to one conversation, time-limited, recorded in the audit log. No notifications to admins or members; reviewed through an audit-log filter. |
| Admin access to metadata | Always, including DM counterparties ("with who") for the network graph, and per-channel counts for private channels. |
| Bronze | Content is service-role only. Admins read Bronze metadata through a view; `slack_users` / `slack_channels` directories stay admin-readable. |
| Deletes | Soft delete everywhere (messages, reactions, memberships). Deleted content kept, shown as a tombstone, readable only via break-glass. Deleted items still count toward engagement at reduced weight. |
| Sync | Nothing through webhooks alone: nightly reconciliation + manual import cover every event type; webhooks and on-demand incremental fetches are latency optimizations. (CLAUDE.md rule.) |
| DMs in sudo | Hidden (same as `member_notes`). Sudo is read-only in chat. |
| Moderation | A report/flag path on messages feeds admins; break-glass is how they read a reported restricted conversation. |
| Hiatus / cancelled | Unchanged: no Hub login, Slack access revoked. Their memberships get `left_at`; their messages stay. |

## Data model

All `chat_*` tables are Local layer (the app is the source of truth), except that Slack-origin rows are re-derivable from Bronze.

### `chat_channels`
| Column | Notes |
|---|---|
| `id` uuid | Stable; `/chat/<id>` URLs are safe to share |
| `kind` | `channel` \| `dm` \| `group_dm` (Hub-native, or a Slack group DM the bot is in) |
| `bridge_mode` | `bridged` \| `app_only` |
| `slack_channel_id` | Unique, nullable (null for app-only) |
| `visibility` | `public` \| `private` |
| `restricted` bool | Admins need break-glass for content. Always true for `dm`/`group_dm` (check constraint). Changes are audited. |
| `bridge_disabled` bool | Bot is in the Slack channel but we don't mirror it |
| `bridge_status` | `ok` \| `disconnected` (bot removed; see `lib/private-channel-access.ts`) |
| `name`, `topic`, `purpose` | Synced from Slack for bridged channels |
| `archived_at`, `created_at` | |

### `chat_channel_members`
`channel_id`, `member_id`, `joined_at`, `left_at` (soft), `last_read_at`, `muted`, `notify_level`, `source` (`slack` \| `app`). Unique on `(channel_id, member_id)`; rejoining clears `left_at`. Slack users with no member record have no row (no Hub account).

### `chat_messages` (metadata only)
| Column | Notes |
|---|---|
| `id` uuid | |
| `channel_id` | |
| `author_member_id` | Nullable: Slack authors we can't match (staff without member records, integrations, unmatched users). Filled in later when an alias is confirmed. |
| `thread_root_id` | One level of threading, same as Slack |
| `origin` | `app` \| `slack` |
| `slack_ts` | Unique with the channel's `slack_channel_id`; links to `bronze.slack_messages` (where the raw Slack user id lives) |
| `slack_sync_status` | App-origin only: `pending` \| `sent` \| `failed` (the outbox) |
| `posted_via` | `user_token` \| `bot` (app-origin bridged messages) |
| `reply_count`, `last_reply_at` | Thread roots |
| `has_files` bool | |
| `created_at`, `edited_at`, `deleted_at` | Soft delete |

No author-name snapshot: an unmatched Slack author's display name comes from `bronze.slack_users` via a narrow view.

### `chat_message_contents` (content)
`message_id` (PK/FK), `body` (markdown), `blocks` (jsonb: Slack `rich_text` / Block Kit as received), `attachments` (jsonb), `search_vector` (generated tsvector). Split from `chat_messages` because RLS is row-level: admins and members share the `authenticated` role, so column privileges can't separate them. See Access control.

### `chat_reactions`
`message_id`, `member_id` (nullable for unmatched Slack users; `slack_user_id` kept for those), `emoji` (shortcode, incl. skin tone e.g. `thumbsup::skin-tone-2`), `created_at`, `deleted_at`, `synced_to_slack` bool. Unique on `(message_id, emoji, member_id)`; re-adding clears `deleted_at`.

### `chat_thread_follows` (later)
App-only "followed threads" for the feed. Slack doesn't expose users' thread subscriptions.

### `member_slack_connections`
`member_id`, `slack_user_id`, encrypted user token (Supabase Vault), scopes, `connected_at`, `revoked_at`. Service-role only.

### `admin_access_grants` (break-glass)
`id`, `admin_id`, `channel_id`, `reason`, `created_at`, `expires_at`, `revoked_at`. Every grant and every content read under it writes an `audit_log` row.

### Bronze additions
- `bronze.slack_channel_members` (`channel_id`, `user_id`, `first_seen_at`, `left_at`, `raw_payload`), filled by `conversations.members` pulls and `member_joined_channel` / `member_left_channel` events. Current state only.
- `bronze.slack_channel_member_events` (`channel_id`, `user_id`, `event` joined/left, `occurred_at`, `source`, `inviter_user_id`, `slack_ts`), the append-only membership history. Slack has no membership-history API, so it is fed three ways: the "joined the channel" / "left the channel" notices in channel history (exact time and inviter; only served for about 90 days), the webhook's live events, and the member list for changes nobody announced (`source = member_list`, time = when we noticed). The `bronze.slack_channel_membership_periods` view collapses the same change reported by more than one source and pairs joins with leaves: one row per stretch a person spent in a conversation.
- `bronze.slack_custom_emoji` (`name`, `image_url`, `alias_for`, `deleted_at`, `raw_payload`), filled by `emoji.list` and `emoji_changed`.
- `bronze.slack_messages.deleted_at` becomes real (today it's always null), and `slack_reactions.deleted_at` becomes real (today removed reactions are hard-deleted).

### Silver: `member_interactions`
`member_a`, `member_b`, `kind` (`dm` \| `thread_reply` \| `reaction` \| `mention` \| `channel_comember`), `channel_id` (nullable), `occurred_at`, `visibility` (`public` \| `private`). Built from `chat_messages` + `chat_reactions` + `chat_channel_members` with DELETE + INSERT by date range. Never holds content. Feeds `/api/members/network` next to prickle co-attendance.

## Access control

| | Metadata (`chat_messages`, members, reactions) | Content (`chat_message_contents`) |
|---|---|---|
| Public channel | Active members, admins | Active members, admins |
| Private channel, not restricted | Channel members, admins | Channel members, admins |
| Private channel, `restricted` | Channel members, admins | Channel members; admins only with an active grant |
| DM / group DM | Participants, admins | Participants; admins only with an active grant |
| Deleted message (any channel) | Same as its channel (shown as a tombstone) | Nobody in the UI; admins only with an active grant |

- **Break-glass reads go through a `SECURITY DEFINER` function** (e.g. `read_restricted_content(channel_id, ...)`) that checks the grant, writes the audit row and returns content. Admins never get a direct RLS path to restricted content. The audit log's trigger mechanism (`docs/ACTIVITY_AND_AUDIT_LOG.md`) only sees writes, so reads must log explicitly.
- **Changing `restricted`** is audited and appears in the same audit-log filter as break-glass, since flipping it off is a way around break-glass.
- **Search never uses grants.** Search runs as the caller under normal RLS.
- **Sudo**: chat reads use `getEffectiveIdentity` like other member pages. RLS evaluates the real admin, so the page itself must hide DMs and restricted content the member could see but the admin can't, and must disable posting.
- **Bronze**: `slack_messages` (text, blocks, files, raw_payload) and raw payloads elsewhere become service-role only. Admins get `bronze.slack_messages_meta` (no content columns). `slack_users`, `slack_channels`, `slack_reactions`, `slack_channel_members` stay admin-readable. Built in `20261009000000_slack_content_privacy.sql`; `slack_files` is service-role only too.
- **Existing leak to fix:** `app/api/process/slack/route.ts` copies the first 200 characters of each message into `member_activities.description`. For restricted channels (and all DMs) that must be null; the member detail page's Slack activity panel must handle it. Fixed: direct messages in `20261004010000`, restricted channels in `20261009000000` (`restricted_slack_channels`, until `chat_channels.restricted` exists).
- Each channel in the Hub shows whether staff can read its content.

## Slack → Hub

### One projection function
`project_slack_messages(channel_id, from, to)` reads Bronze and upserts `chat_messages` / `chat_message_contents` / `chat_reactions` for that scope, including soft deletes. The webhook calls it for one message; reconciliation and manual imports call it for their window. A missed webhook heals as soon as Bronze is backfilled.

### Webhook (`app/api/webhooks/slack/route.ts`)
Respond within Slack's 3 seconds; do the work after the response. Handle:
- `message` with subtypes: plain, `thread_broadcast`, `file_share`, `message_changed` (update the original row from `event.message`), `message_deleted` (soft delete by `deleted_ts`), `tombstone`, `channel_join` / `channel_leave`. Today every message event is treated as new and keyed on `event.ts`, which is wrong for changed/deleted.
- `reaction_added` / `reaction_removed` (soft remove).
- `member_joined_channel` / `member_left_channel` (the bot joining a channel auto-creates a bridged `chat_channels` row).
- `channel_rename`, `channel_archive`, `channel_unarchive`, and the `group_*` equivalents; `emoji_changed`; `user_change`.
- Drop events for messages the app posted itself (see Loop prevention).

### Gap-fill (on-demand incremental fetch)
If an event refers to something we don't have (a reply whose thread root is missing, a reaction or edit on an unknown message), fetch that thread (`conversations.replies`) or the channel since our newest message (`conversations.history`). Coalesce bursts to one fetch per channel. Opening a bridged channel in the Hub triggers the same catch-up. Each fill is recorded (source, scope, rows recovered) and shown on `/admin/data-health`; many recovered rows means the webhook was down. (Checkly can't see this.)

### Nightly reconciliation + manual import
Every webhook-handled event type has a pull:

| Event | Pull |
|---|---|
| Messages, edits | `conversations.history` + `conversations.replies`, upsert |
| Deletes | Messages in the window that Slack no longer returns → `deleted_at` |
| Reactions | Reactions on fetched messages; missing → `deleted_at` |
| Membership | `conversations.members` per bridged channel; missing → `left_at` |
| Channels and group DMs | `conversations.list` with `public_channel,private_channel,mpim` (today it omits `mpim`, so group DMs are webhook-only) |
| Custom emoji | `emoji.list`; missing → `deleted_at` |
| Users | `users.list` |

Soft-deleting what's "missing" only happens for scopes whose fetch fully succeeded.

**Ageing out of Slack is never a deletion.** The Hub keeps Slack messages for good; Slack's API stops returning them after about 90 days. So a message Slack no longer returns is only marked `deleted_at` when it is newer than 80 days and older than 15 minutes, its channel's history (or, for a reply, its thread) was fetched completely in that run, and no more than a handful of the channel's messages went missing at once (otherwise the import marks nothing there and reports an error, since that looks like Slack changing what it returns). The webhook likewise ignores a delete event for a message older than 90 days, which could only be Slack's own clean-up. A message that turns up again in a later fetch is un-deleted. Rules and tests: `lib/slack-deletions.ts`.

### Slack free plan

We're on Slack's free plan, which changes what "archive" means:

- **The API only serves about the last 90 days.** Anything older that we didn't capture at the time is gone for good. A reconcile that fails, or silently skips part of its scope, for 90 days is permanent data loss, so reconcile failures (including partial ones: a channel's fetch erroring, the thread-reply pass timing out) must alert, not just log. Checkly's heartbeat only covers "the cron didn't run".
- **Slack deletes messages and files older than one year** on free workspaces. Our earliest capture is 2026-03-27, so from about 2027-03 the Hub copy becomes the only copy, oldest first.
- **Files have to be copied while Slack still has them.** Copying file contents into Supabase Storage moves from "later" into the groundwork phase: it only needs Bronze, so it can start long before any chat UI.

### Bronze audit (2026-09-30)

Counts from prod `bronze.slack_messages`, 4,835 rows:

- **Permanent gaps** (unrecoverable on the free plan): nothing before 2026-03-27; almost no thread replies before July (3 in April–June vs. ~500/month from July on, so roughly 1,200–1,500 missing); private channels only from about June 1 (the bot was invited late).
- Top-level messages in public channels from 2026-03-27 on look complete (~400–480/month).
- **344 rows exist only because the webhook caught them** (the 90-day API import didn't return them):
  - 75 `channel_join` / `channel_leave` notices stored as messages. `process/slack` doesn't filter subtypes, so each counts as a `slack_message` activity and inflates engagement. Fix: the webhook routes these to membership, not messages; delete the 75 rows from Bronze and reprocess Slack activity.
  - 24 in group DMs (Wheel of Wonder rooms) that the import never fetches. Fix: add `mpim` to the import.
  - 243 real member messages, almost all thread replies in private channels. Cause: the 2026-09-25 bot token rotation (`auth.revoke` + reinstall, per `docs/SECRET_ROTATION.md`) fully uninstalled Billie Bot, which removed it from all 13 private channels. The import only sees private channels the bot is in, so it has skipped them since, and the thread-reply pass (added 2026-09-29) never reached them. `/admin/hygiene` flagged it, but nothing notified anyone. Fix: re-invite the bot to each private channel and run a manual 90-day import before replies age out of Slack's window.

## Hub → Slack

### Posting identity
1. Member has connected Slack (`member_slack_connections`): post with their user token. Native in every way (edit/delete from Slack, correct attribution).
2. Otherwise: bot posts with `username` + `icon_url` set to the member's name and avatar. Slack shows an "APP" tag, and the member can edit/delete only from the Hub.

Reactions are the exception: the bot can't react under someone else's name. Fallback reactions stay in the Hub only (`synced_to_slack = false`) instead of showing as "Billie Bot reacted". Connected members' reactions sync. The Hub prompts people to connect Slack.

### Outbox
The app writes the message (`slack_sync_status = 'pending'`), then calls `chat.postMessage` and stores `slack_ts`. Failures stay `pending`/`failed` and are retried by gap-fill and nightly reconciliation. Edits → `chat.update`, deletes → `chat.delete`, reactions → `reactions.add` / `reactions.remove`.

### Loop prevention
Every post carries `metadata: { event_type: "hub_message", event_payload: { app_message_id } }`. The webhook drops events carrying our `app_message_id`, which works even if Slack's event arrives before we've stored `slack_ts`. Verify in phase 2 that metadata comes back on events and in `conversations.history` (`include_all_metadata`); the fallback is matching on our bot id + a short-lived pending row.

### Membership
Adding someone in the Hub → `conversations.invite`; removing → `conversations.kick` (Slack shows "removed by Billie Bot"); leaving yourself → your own token's `conversations.leave` when connected. A member without a Slack account gets Hub-only membership (Slack users won't see them in the member list; the UI notes this). Bridged Slack group DMs are the exception: Slack can't change a group DM's members, so their membership is read-only in the Hub.

## Content handling

- **Formatting**: render from Slack's `rich_text` block (exact mentions, links, lists, code), falling back to `text`. Translate both ways: `<@U123>` ↔ member mention, `<#C123>` ↔ channel link, links, emoji shortcodes.
- **Block Kit (display)**: render a supported subset (section, context, header, divider, image). Anything else falls back to the message's `text` with "Open in Slack".
- **Interactive elements**:
  - Our own bot's messages (Wheel of Wonder, prickle check-in and check-out DMs): action handlers become Slack-independent (`handleAction(actionId, value, memberId)`), called by both the Slack interactions webhook and a Hub server action; the resulting update goes to both sides.
  - Third-party apps (polls, Workflow Builder, Zoom, Calendar): clicks go to that app's server with Slack's signature, so the Hub shows them disabled with "Open in Slack".
  - Longer term, our notifications become Hub-native cards, rendered to Block Kit only when sent to Slack.
- **Emoji**: replace the hand-picked `lib/slack-emoji.ts` with a full dataset (`emoji-datasource` or `emojibase`), lazy-loaded in the picker. Custom emoji from `bronze.slack_custom_emoji`; lookup order custom → Unicode → plain `:name:`. Images link to Slack's CDN at first; copy to Supabase Storage before leaving Slack. Hub-only custom emoji wait for app-only channels (Slack only accepts reactions it knows).
- **Files**: copy Slack files into Supabase Storage on ingest, starting in the groundwork phase (free plan: Slack deletes them after a year). Until the chat UI renders them, they're just archived. Hub uploads go to Slack with `files.uploadV2`.

## Search

Postgres full-text search over `chat_message_contents.search_vector` (GIN index), queried as the caller so RLS decides what's searchable. Filters: channel, author, date range, has-file, in-thread. Deleted messages excluded. `pg_trgm` for fuzzy name/channel matching. Semantic search (pgvector) is a possible later step. Because the Hub is the archive, search ships with the read-only mirror, not later.

## Engagement and the network graph

- **Attribution comes from `chat_messages.author_member_id`**, not the Slack user id. Today `process/slack` credits bot-posted messages to the bot (`msg.user || msg.bot_id`), and Wheel of Wonder skips anything with a `bot_id`, so a member replying from the Hub via the bot fallback would count for nothing. With the metadata above, every Hub-posted message resolves to its real author.
- Private channels and DMs count. Activity rows from restricted channels and DMs carry no text.
- Deleted messages and removed reactions keep their activity rows with a reduced `engagement_value` (start at 0.5×). Toggling a reaction counts once.
- Admins see per-channel counts for private channels and DM counterparties via `member_interactions`.

## Realtime and read state

Supabase Realtime subscription on `chat_messages` (RLS-filtered) for the open channel, content fetched from `chat_message_contents` on receipt; a lighter subscription for unread badges. Read state is `chat_channel_members.last_read_at`. First use of Realtime in this app.

**Built (2026-10-10), open conversation:** `components/chat/ChatLive.tsx` listens to `chat_messages` (filtered to the channel) and `chat_reactions` (ignored client-side unless on a message shown) and re-renders the server page with `router.refresh()`, debounced; events are only a signal, so content still comes through the access-checked loaders. `chat_message_contents` is not published: it has no channel column to filter on, and a message's content is written in the same transaction as the message. A new message follows the reader when they are at the bottom, and waits behind a "New messages" pill when they have scrolled up, so history never jumps. Two gotchas: the page scrolls inside the layout's `<main>`, not the window, and the browser client joins Realtime as `anon` unless the session's access token is set first (then the channel filter is rejected and nothing arrives, silently), so `ChatLive` calls `realtime.setAuth` before subscribing.

**Layout (2026-10-10):** the chat UI mirrors Slack's three panes for familiarity: the conversation list pinned on the left (its own scroll), the conversation in the middle (a fixed header and a message pane that scrolls by itself, opening at the newest message), and a right panel that opens for a thread (`?thread=<message id>`) or a member profile (`?profile=<member id>`; clicking an author's name or avatar) and closes with its ✕, which keeps `?before=`. On wider screens the panel is resizable (`SidePanel`): drag its left edge, or focus it and use the arrow keys (Shift for bigger steps, Home/End for the limits, Enter or a double-click to reset); 320px to 900px and at most 60% of the row so the messages keep room; the width is remembered per device in `localStorage` and shared by threads and profiles. Opening or closing a panel doesn't move the message pane (the links use `scroll={false}`), and a thread wins over a profile. The panel covers the conversation on narrow screens. Pages that are plain documents (search, members) scroll inside the area and pad themselves. The sidebar has two separate searches: "Search messages" (full text, goes to `/chat/search`) and "Find a channel", a type-ahead that only narrows the conversation list (by name, ignoring case and a leading `#`). On a narrow screen it works like Slack mobile: the conversation list is the home screen at `/chat`, a conversation replaces it (with a "← Channels" link), and a panel covers the conversation.

### Read state, unread badges and the "new messages" line (2026-10-10)

`chat_channel_members.last_read_at` is the member's read marker per conversation (`20261017000000_chat_read_state.sql`). Members can't write that table, so `chat_mark_read(channel, through)` (SECURITY DEFINER, bound to `current_member_id()`) moves only the caller's own marker, forward only and never past now; `chat_unread_counts()` (SECURITY INVOKER, so RLS still applies) counts top-level, live messages by others newer than the marker (or than `joined_at` for a membership that never read), capped at 100 per conversation, for conversations the member is in. Everyone started caught up (the migration set every null marker to now). Both have pgTAP tests (`chat_read_state.test.sql`).

- **The marker moves when the reader leaves, not when they open.** `ChatLive` calls the `markChatRead` server action when the conversation unmounts, the tab is hidden or the page is closed, through the `created_at` of the newest message that was on the page (the raw string: a JavaScript `Date` rounds to the millisecond and would leave the newest message a few microseconds "unread" for good). Moving it on open would move the line below on the next refresh. Messages that arrived behind a "New messages" pill stay unread. Sudo is read-only and never marks anything.
- **The line.** The page draws a "New" line (`UnreadDivider`) above the first message by someone else newer than the marker it read when it rendered, and opening a conversation scrolls to it (else to the newest message). Not on `?before=` pages, in sudo, or for public channels the member hasn't joined (no marker to compare with).
- **Badges.** The sidebar shows a bold name and a count per conversation with unread messages (99+ beyond the cap). The layout doesn't re-run on client navigation, so the sidebar keeps the numbers itself: it starts from the server's, adds a message as it arrives over Realtime (an unfiltered INSERT subscription; RLS limits it to what the member can read) in a joined conversation that isn't open, ignoring their own messages, replies and deleted ones, zeroes a conversation when it is opened or left, and starts over from the server's numbers after a refresh. No counts in sudo.
- **Older messages.** `MessageList` keeps everything the reader has been shown, merged by id, so "Load older messages" (the `loadOlderChat` server action, also triggered by scrolling to the top) puts the next page above without moving the reader, and messages that fall off the top of the server's newest-40 window as new ones arrive don't disappear.
- **Profile panel.** `loadMemberCard` + `ProfileCard`: name, photo, "Hedgie since", bio, "Ask me about…" topics, earned badges (`getMemberBadges`, the same computation as the full profile) and social links, built from the same shared pieces (`components/member/`: `AskMeAboutTopics`, `MemberBadgeChips`, `MemberSocialLinks`) as the full profile page. No private notes, last prickle or hosting stats.
- **Realtime gotcha:** `lib/chat/live.ts` (`authenticateRealtime`) must run, and the caller must check it wasn't cancelled, *before* creating a channel. A channel created by an effect that React then tears down shares its topic with the live one, and removing it drops the live one's events.

## Migration path

Per channel: switch `bridge_mode` from `bridged` to `app_only`. The bot posts a final "this channel moved to the Hub →" message and the Slack channel is archived. From then on the Hub owns its membership. The `/privacy` page and notification framework need to be live before asking anyone to move.

## Slack app configuration

**Never uninstall Billie Bot casually.** Uninstalling removes it from every channel; public channels come back through the import's auto-join, but every private channel and group DM needs a manual `/invite @Billie Bot` from a member, and with the bridge live those conversations stop syncing until then. Scope changes use "Reinstall to Workspace", which should keep memberships.

**Token rotation:** classic bot tokens never expire, so rotating one means `auth.revoke` + reinstall, which is an uninstall. Before the bridge ships, opt the app into Slack's token rotation (12-hour access tokens + refresh tokens). Rotation then happens continuously with no uninstall, and a leaked token dies on its own. Opting in is irreversible and means tokens live in the database (service-role only), not an env var, with a refresh before use when near expiry. `member_slack_connections` user tokens rotate the same way.

- **Bot scopes** (add what's missing): `channels:history`, `groups:history`, `channels:read`, `groups:read`, `chat:write`, `chat:write.customize`, `reactions:read`, `reactions:write`, `users:read`, `users:read.email`, `emoji:read`, `mpim:history`, `mpim:read`, `channels:manage`, `groups:write`, `files:read`, `files:write` (later).
- **User scopes** (per-member connect): `chat:write`, `reactions:write`, `channels:write`, `groups:write`.
- **Events**: `message.channels`, `message.groups`, `message.mpim`, `reaction_added`, `reaction_removed`, `member_joined_channel`, `member_left_channel`, `channel_rename`, `channel_archive`, `channel_unarchive`, `group_rename`, `group_archive`, `group_unarchive`, `channel_created`, `emoji_changed`, `user_change`.

## Phases

Status, 2026-10-06. Done in groundwork: webhook edits/deletes/bot posts/join filtering; resumable import (only threads behind Slack, oldest first, heartbeat only when none are left behind); atomic Slack activity rebuild, one week per database call (rewriting 90 days in one statement ran past production's 8s statement timeout); `audit_log` and the admin Activity Log page (the break-glass / restriction-change filter is still to add); chunked attendance rebuilds; and the capture work (group DMs via `mpim`, `bronze.slack_channel_members`, `bronze.slack_custom_emoji`, `bronze.slack_files` + the private `slack-files` bucket, with direct-message text kept out of `member_activities`). Capture details: `lib/slack-capture.ts`. Files over 20 MB and files hosted outside Slack are recorded but not copied. The notification framework (listed under "Later") also exists now: `lib/notifications/`.

Also done (2026-10-07): removed reactions are soft-deleted (`deleted_at`) by the webhook and the import; the import marks messages deleted in Slack, with the safeguards under "Nightly reconciliation" above. Soft-delete columns are all named `deleted_at` (`slack_reactions` and `slack_custom_emoji` used `removed_at`).

Also done (2026-10-08): channel membership history (`bronze.slack_channel_member_events` and the periods view, see "Bronze additions"). The join/leave notices an early webhook stored as messages were converted into events and removed from `slack_messages`, with the activity rows they had produced.

Also done (2026-10-09), privacy: Bronze content lock-down (`slack_messages` and `slack_files` are service role only, admins read `bronze.slack_messages_meta`, `raw_payload` hidden on the other Slack tables); `restricted_slack_channels` (Local) with an admin page at `/admin/data/slack-channels`, which keeps message text out of `member_activities.description` and clears what was already copied; and the Activity Log's Privacy view (`?view=privacy`) over restriction changes. Phase 2 moves the flag to `chat_channels.restricted`, seeded from this table; break-glass grants and reads join the Privacy view when they exist (`PRIVACY_ENTITY_TYPES` in `lib/activity-feed.ts`).

Still open in groundwork: counting deleted messages and removed reactions toward engagement at reduced weight (they are excluded today; `engagement_value` is an integer, so "half" needs a decision); alerting when the bot loses a private channel. Neither blocks phase 2.

Also done (2026-10-10), phase 2 part 1: the `chat_*` mirror schema and projection (`20261010000000_chat_mirror.sql`): `chat_channels`, `chat_channel_members`, `chat_messages`, `chat_message_contents`, `chat_reactions` with the access rules from "Access control" as RLS (helpers `chat_is_channel_member`, `chat_can_see_channel`, `chat_can_read_content`; admins get metadata everywhere and content only outside restricted conversations; a deleted message's content is unreadable through the API). Two paths keep it current, because chat is high volume. The **webhook** projects just the one message it touched (`project_slack_chat_message`, via `lib/chat-projection.ts`): a few indexed lookups whatever the day's traffic, with authors read from `chat_slack_authors`, the Slack-user-to-member map saved by the last full run (an unmatched or brand-new user stays null until then). The **import** (nightly, manual) runs `/api/process/chat`, which saves that map, projects channels and membership (`project_slack_chat_channels`) and then messages one week per call (`project_slack_chat_messages`). The `chat` entry in `SILVER_DEPENDENCIES` is for the import path; the webhook passes `exclude: ["chat"]` to `triggerReprocessing`, because a windowed projection per event would re-read the whole two-day window each time. Channel and membership events reach chat at the next import for now. `chat_channels.restricted` is still written through `restricted_slack_channels` (trigger keeps it in sync); moving the write path is open. Still to do in phase 2: the UI behind a `chat` feature preview, then search.

Also done (2026-10-10), phase 2 part 2: the read-only chat UI behind the `chat` feature preview (off for members): `/chat` with the member's conversations in a sidebar (`app/(member)/chat/layout.tsx`), `/chat/<id>` for the newest messages (`?before=` for older ones) and `?thread=<message id>` for a thread. Each page starts with `requireChat()` (`lib/chat/access.ts`: signed in, member record, the viewed member's flag in sudo). The list is scoped to public channels plus conversations the member is in, even for admins (an admin's RLS would show more; reading others' private conversations is not what member chat is for). Messages render Slack text through `lib/chat/render.ts` (bold, italic, strike, code and fences, quotes, links, mentions, channel links, emoji; `rich_text` blocks later), with deleted messages as tombstones, content the viewer can't read as "You can't read this message", reactions as chips, and no notes about staff access anywhere in chat (the privacy page covers that). In sudo, group messages are hidden and restricted conversations show a notice instead of messages. Author names come from `member_directory`; unmatched Slack authors and `<@U..>` mentions use narrow service-role lookups (`lib/chat/names.ts`) that return only display names. Not built yet: files (search is below).

Also done (2026-10-09), phase 2 part 3: chat search. `search_chat_messages` (`20261015000000_chat_search.sql`) is a `SECURITY INVOKER` SQL function over `chat_message_contents.search_vector` (GIN index), so RLS decides what matches: deleted messages, restricted content an admin can't read and other people's private conversations never appear, and there is no grant path. The search box takes Slack's syntax (`lib/chat/search-syntax.ts`): words, `"phrases"`, `-excluded`, `prefix*`, `in:#channel`, `from:@name` / `from:me`, `before:` / `after:` (exclusive) / `on:` / `during:` (a day, `YYYY-MM` or `YYYY`, UTC), `has:file|link|reaction`, `is:thread`; the parser builds a `to_tsquery` expression, so no user text reaches Postgres as query syntax, and modifiers alone are a valid search. `with:`, `to:`, relative dates (`yesterday`) and `has:pin|star` are not supported. The form's own filters (channel, name, dates, checkboxes) do the same thing and a modifier wins over its field. `/chat/search` (`lib/chat/search.ts`) scopes the search to the conversations the sidebar lists (in sudo, no restricted ones) and shows ranked hits as chat messages with a link to their thread, 20 per page; the sidebar has a search box. Not done: highlighting matched terms, `pg_trgm` fuzzy matching, semantic search.

Also done (2026-10-10), phase 3 part 1: posting from the Hub with the bot fallback, behind its own `chat_posting` feature preview (on top of `chat`; never in sudo). A message box under each conversation the member is in and in a thread panel (`components/chat/Composer.tsx`; Enter sends, Shift+Enter is a new line; Hub text is plain, escaped for Slack so it can't mention or link). **The outbox** (`20261018000000_chat_posting.sql`): `chat_post_message(channel, body, thread_root)` (`SECURITY DEFINER`, bound to `current_member_id()`; members have no INSERT on `chat_messages`) checks the caller is in the conversation, that it is bridged, mirrored, not disconnected and not archived, that the body is 1 to 4000 characters, and that a thread root is a top-level message already in Slack; it writes the message (`origin = 'app'`, `slack_sync_status = 'pending'`, `posted_via = 'bot'`, no `slack_ts`) and its content. The `sendChatMessage` server action then calls `sendChatMessageToSlack` (`lib/chat/slack-post.ts`): `chat.postMessage` as the bot with the member's name and photo (`username`, `icon_url`) and `metadata` `{ event_type: "hub_message", event_payload: { app_message_id } }`, then `chat_mark_message_sent` stores the ts. A refused or failed post is marked `failed`; the author sees "Slack didn't get this message" with a Retry (`retryChatMessage`), and the nightly `/api/process/chat` run retries pending and failed messages between 2 minutes and 24 hours old, oldest first (`retryUnsentChatMessages`). Nothing is posted outside production unless `SLACK_TEST_MODE=false`: the message stays `pending`, like every other Slack send. **Loop prevention:** Slack's event for our post lands in Bronze like any message; a trigger on `bronze.slack_messages` (`chat_adopt_posted_message`) reads the `app_message_id` in its metadata and stores the ts on the app row before the projection runs, so the projection updates that row (same channel and ts) instead of adding a copy. If the event beat the response (or carried no metadata), `chat_mark_message_sent` folds the copy into the app row instead (re-pointing its replies). The projection keeps the app row's author because an unmatched bot author never overwrites a known one. **Manifest:** adds `chat:write.customize` and `metadata.message:read`; pushing it needs a "Reinstall to Workspace" (not an uninstall, see "Slack app configuration"). **Not in this part:** Slack connect (user tokens), edits, deletes, reactions from the Hub, membership invite/kick, gap-fill on open, `member_interactions`. (Crediting Hub-posted messages to their author is part 2, below.)

Also done (2026-10-10), phase 3 part 2: **attribution**. A message written in the Hub is posted by the bot, so in Bronze its user is the bot and no member maps to it. Slack `member_activities` (`reprocess_slack_activities_atomic`, `20261019000000`) now credit it to the author on the app-origin `chat_messages` row with the same channel and ts (soft-deleted messages stay out, as for any message), and the webhook's Wheel of Wonder tracking counts it for that member (`hubMessageAuthor` in `app/api/webhooks/slack/route.ts`, from the post's `hub_message` metadata) instead of skipping every bot post. Other apps' posts still count for nobody. A Hub post's activity row appears once its ts is stored on the chat row (when Slack's event arrives with metadata, or when the send completes); a rebuild that ran before that picks it up on the next rebuild of the window (the nightly import).

Also done (2026-10-10), phase 3 part 3: **reactions from the Hub**, same `chat_posting` gate (never in sudo). `chat_toggle_reaction(message, emoji)` (`20261020000000_chat_reactions.sql`, `SECURITY DEFINER`, bound to `current_member_id()`) adds the caller's reaction, soft-deletes it on a second press and restores it on a third. It works in public channels and conversations the caller is in (an admin's wider read access doesn't count), not on a deleted message or in an archived conversation, and only for a Slack-style shortcode. As designed, the bot can't react under someone else's name, so a Hub reaction is a member-keyed row (`slack_user_id` null) with `synced_to_slack = false` and stays in the Hub; the Slack projection only upserts rows keyed by `slack_user_id`, so it never touches them. Connected members' reactions will sync once Slack connect exists. The UI (`components/chat/ReactionBar.tsx`): chips become toggles (`aria-pressed` for your own) and a "＋" opens a small picker of common emoji; a member who reacted in Slack and in the Hub with the same emoji counts once. Not yet: a full emoji picker (the doc's emoji-dataset item), and removing your own Slack-origin reaction from the Hub.

1. **Groundwork**
   - `audit_log` v1 (from `docs/ACTIVITY_AND_AUDIT_LOG.md`) plus an admin view with a break-glass / restriction-change filter.
   - Bronze fixes: webhook subtypes, soft delete for messages and reactions, membership and emoji pulls, content lock-down + `slack_messages_meta` view; move the admin pages that read Bronze content (Slack engagement insights, reconciliation) to server-side metadata reads.
   - Stop copying message text into `member_activities.description` for restricted channels and DMs.
   - From the Bronze audit: webhook stops storing join/leave notices as messages (and the 75 existing rows are removed + Slack activity reprocessed); import fetches `mpim`; re-invite the bot to the private channels it lost on 2026-09-25 and backfill.
   - Rebuild Slack `member_activities` atomically (DELETE + INSERT in one SQL function, like `reprocess_prickle_attendance_atomic`). Today `/api/process/slack` deletes the range and then inserts in batches, so a failed batch leaves a gap until the next run (2026-10-03: ~7,000 activities missing after Supabase returned 520s).
   - Alert on reconcile failures, including partial ones, and when the bot loses access to a private channel (today that only shows on `/admin/hygiene`).
   - Copy Slack files into Supabase Storage.
2. **Read-only mirror** (**done**, 2026-10-10): `chat_*` schema with the content/metadata split and RLS (pgTAP), projection + backfill, channel list and channel view, search v1, `restricted` flag. Deliberately no "staff can read this" indicator in the UI (the privacy page covers it). Not done, optional: search term highlighting, `pg_trgm`, semantic search.
3. **Two-way bridge** (**in progress**, still read-only until its first PR lands): posting with bot fallback, Slack connect (OAuth), outbox, loop prevention, edits/deletes/reactions, membership invite/kick, gap-fill + catch-up on open, attribution fixes in `process/slack` and Wheel of Wonder, `member_interactions`.
4. **Hub-native**: app-only channels, DMs and group DMs, Realtime, unread counts, break-glass UI, report/flag path. Turn on `message_privacy` once every statement on `/privacy` is true. **Already built, read-only:** Realtime for the open conversation, unread badges and the read marker, the "New" line, in-place older messages, the profile panel and the Slack-style layout (see "Realtime and read state"). **Not started:** app-only channels, DMs, break-glass UI, report path.
5. **Later**: rendering files in chat, notification framework, Block Kit subset + shared action handlers, custom emoji copies, migration tooling, forum exploration.

## Testing

- pgTAP (`supabase/tests/database/`): every row of the access-control table, break-glass grant expiry, audit rows written on grant and read, `restricted` always true for DMs, search respecting RLS.
- Reprocessability (`tests/api/reprocessability/`): the Bronze → chat projection and `member_interactions` (create, change, delete → soft delete, reprocess).
- Idempotency (`tests/api/idempotency/`): membership and emoji pulls, webhook subtypes replayed.
- Loop prevention and outbox retry with a mocked Slack client.
