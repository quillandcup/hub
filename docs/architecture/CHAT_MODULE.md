# Chat core and the Slack adapter

> **Status:** living. **Last reviewed:** 2026-11-22. Review: yearly. Kept up to date with the code; if it is wrong, fix it.

Chat is a conversation product: messages, channels, threads, reactions, files, rich text, link previews, drafts, search, unread counts, notifications. Slack is where the Quill & Cup conversations also live, and today the two are welded together (about 100 files in `src/lib/chat` and `src/components/chat` mention Slack). The split is **in place**, in steps, so that chat core can be reused by another app later (a thread attached to a building or a work order, a second community) and so that "what is chat and what is Slack" is a line in the code, not a feeling. Behavior for members does not change. The pattern is the one of [Page blocks](PAGE_BLOCKS.md): a port owned by the host, an adapter under `src/modules/`, a composition root that lists what is installed, lint and a test that keep the line.

## The pieces

| Piece | Where |
|---|---|
| The port: `ChatTransport` (what core asks a transport for), `ChatInboundSink` (what a transport reports to core) | `src/lib/chat/transport.ts` |
| The registry core reads (`chatTransport()`, `NO_TRANSPORT` when none is installed) | `src/lib/chat/transports.ts` |
| The composition root: the one list of installed transports | `src/modules/chat-transport.ts` |
| Core's outbox: `deliverChatMessage` records what a transport answers, `retryUnsentChatMessages` is the nightly retry and expiry | `src/lib/chat/delivery.ts` |
| Where chat files live and their size cap (neutral names; the bucket keeps its original name) | `src/lib/chat/file-limits.ts` |
| The Slack adapter (`slackTransport`) and its outbound code: post, edit, react, upload, unfurl removal, read markers, escaping, rich-text blocks, membership | `src/modules/chat/slack/` (`index.ts` is the port implementation) |
| Core's inbound side: what chat does with a message, edit, delete or reaction a transport reports (the projection, notifications) | `src/lib/chat/inbound.ts` (`chatInbound`, the sink core implements) |
| The Slack adapter's inbound side: the events handler (signature, decoding, Bronze rows, gap-fill, lesson links), DM pulls, DM event decisions, unfurl removal from Slack's side | `src/modules/chat/slack/webhook.ts` (`src/app/api/webhooks/slack/route.ts` is a thin route that calls it), `dms.ts`, `dm-events.ts`, `gap-fill.ts`, `side-unfurl-removal.ts`, `lesson-links.ts` |
| Slack code still outside the adapter's folder: the `src/lib/slack-*.ts` libraries and the baseline files | see "What remains" |
| The boundary: lint rule and baseline | `config/eslint.mjs`, `config/chat-core-baseline.json`, `tests/lib/chat-core-boundary.test.ts` |

## What core is, what the adapter is

Classification of the chat code at the first step (counts are files; step 2 moved 9 outbound files and split one, and shrank the mixed class to 8):

| Class | Files | What |
|---|---|---|
| Core | about 117 of the 150 in `src/lib/chat`, `src/components/chat`, `src/app/(member)/chat`, `src/app/api/chat`, `src/app/api/process/chat`, `src/lib/data/chat*.ts` | messages and channels, reactions, drafts, files and staging, rich text and smart typography, link previews and their blocks, hub links, emoji, search, unread, notifications, rendering, the whole UI |
| Slack adapter | 13 in `src/lib/chat` (`slack-*.ts` and `gap-fill.ts`), the 21 `src/lib/slack-*.ts` libraries (shared with sign-in and the Slack notifier), the Slack webhook and the `slack-dms` reconcile route | Slack ids, tokens and authors; posting, editing, deleting and reacting in Slack; mrkdwn escaping and blocks; unfurl removal; channel membership; read-marker sync; DM pulls; gap-fill from Slack; lesson links pasted in Slack |
| Mixed | 7 now (20 at the first step), the baseline | a core file that still names a Slack thing: Slack avatar photos and author names, file downloads with Slack tokens, the Slack connection check for access, the Slack permalink, the emoji short-code map, the nightly projection |

## The port

`ChatTransport` is what core asks of a transport. Every method is safe to call when the transport has nothing to do (message not delivered yet, member not connected, not production): it answers `"skipped"`, `false` or `{ ok: true }` and does not throw for a normal refusal.

- **Outbound:** `send` (send one stored message and answer a `SendOutcome`: `sent` with the transport's reference and how it went out, `skipped`, or `failed`), `syncReaction`, `editMessage`, `deleteMessage`, `deleteFile`, `removePreview` (stop one link preview showing in the transport), `keepFileCopies`, `updateAppMessage` (replace a message the app itself posted, for the check-in DM controls).
- **Who is in a conversation:** `externalIdsFor` (the transport's ids for members, for mentions and invites), `addToConversation` and `removeFromConversation`, each answering a `MembershipChange` (`result`, and `reconnect` when the member's own link failed and the transport acted for them). Who may do what stays in core (`membership-actions.ts`); how it is done, as the member or as the app, is the transport's.
- **State:** `writesEnabled` (may this deployment write to the real system), `isConnected` (may this member write through the transport), `pushRead`, `pushUnread`, `pullRead` (read markers, both ways).
- **Conversations:** `pullDirectConversations` and `openDirectConversation` (direct conversations written outside the Hub).
- **Delivery status is core's.** A transport never writes it: `deliverChatMessage` (`src/lib/chat/delivery.ts`) calls `send` and records the outcome on the message (the reference and `via` for a sent one, failed for a failure, nothing for `skipped`; a sent message without a reference stays pending until the transport's own event links it). `retryUnsentChatMessages` (nightly) expires what is too old and sends again what is due, through the same function. A failed message is retryable and core shows "didn't send" with a Retry.

`ChatInboundSink` (`src/lib/chat/transport.ts`) is what a transport reports to core, and core's `chatInbound` (`src/lib/chat/inbound.ts`) is its implementation. Two calls, with the transport's own references (`channelRef`, `ref`) and never its event shape: `messageChanged(db, { kind: message | edit | delete | reaction })` brings the chat copy of one message in line with what the transport stored and answers `present` (whether the chat has it), and `messageArrived` tells the people a new message concerns. The transport decodes and verifies its events, keeps its own raw copy (Slack's Bronze rows) and runs its own touch-ups (gap-fill from Slack, a lesson address pasted into Slack becoming the video card, member notices, Wheel of Wonder counts) between the two calls. Core's calls are idempotent and order-free because the projection reads what the transport stored: the same event twice, a reaction before its message, or an edit before its message end in the same chat state, and one for a message the chat does not have answers `present: false` (the transport's gap-fill and the nightly import bring it). Slack has a pull-based counterpart for every event it pushes (gap-fill, the nightly import, the DM pulls), as the data-pipeline rules require.

The port is deliberately a coarse facade of what the call sites did before, not a design for every transport. Names that were Slack's are neutral (`removePreview`, `OpenConversationResult.reason: "refused"`); the adapter maps.

## The adapter owns

Slack ids and tokens (the member's own token or the bot's), the choice between them, Slack's rate limits and dead-token handling (which revokes the connection), mrkdwn escaping and rich-text blocks, the unfurl switches, the author and photo mapping, channel membership and the as-member variants, and the `chat_messages` Slack columns (`slack_ts`, channel ids). A table that holds Slack-only data belongs to the adapter's side of the seam wherever the table is; it is still read only through `src/lib/data` repositories.

## Boundary

`config/eslint.mjs` has a rule for the chat core file set: it may not import `slack`, `slack-*` (`src/lib/slack-*`), `gap-fill`, `@slack/*` or a module's internals. The adapter's own files are exempt, and so are the files in `config/chat-core-baseline.json`, each with the reason it still names Slack and what moves it. `tests/lib/chat-core-boundary.test.ts` checks the rule against sample imports, scans the real files, and fails on a file that violates and is not listed, on a listed file that no longer violates (the baseline only shrinks), and on a core file other than the registry that names the composition root.

## Plugging in another transport

1. Implement `ChatTransport` (start from `NO_TRANSPORT`, which does nothing, and override what the transport can do) in `src/modules/chat/<name>/`, owning its ids, tokens and formatting.
2. Add it to `installedChatTransports` in `src/modules/chat-transport.ts`. Core takes the first installed one today; routing several (a transport per conversation) is a later decision made in `createChatTransportRegistry`, not in a transport.
3. Report inbound events through `ChatInboundSink` (`chatInbound` is the default implementation; pass another in tests).
4. Tests: a fake in-memory transport in `tests/lib/chat-transport.test.ts` shows the shape; core must work with only that installed, or with none.

## What remains

Steps, each its own pull request and green on its own:

1. **The port, the registry, the Slack adapter facade, the lint rule and the baseline.** Done.
2. **The outbound Slack code moved into `src/modules/chat/slack`, the outbox recorded by core, membership and the DM controls on the port, neutral file constants.** Done. Slack's rich-text block builder moved; the reading half (`blocksToBody` in `src/lib/chat/rich-blocks.ts`) stays in core's loader until step 3. The Slack code still outside the folder may import the adapter's helpers (`CHAT_SLACK_SIDE_FILES` in `config/eslint.mjs`); core may not.
3. **The inbound Slack code, in two pull requests.** **3a, done:** `gap-fill`, DM pulls and DM event decisions, unfurl removal from Slack's side, lesson links and the webhook handling moved into `src/modules/chat/slack`; the events route is thin; core's `chatInbound` does the projection and notification; catching a conversation up is a port method (`catchUp`). **3b, open:** the author and photo mapping (`names.ts`, `avatar-copy.ts`), `blocksToBody`, the nightly projection (`process/chat`), file download tokens (`file-token.ts`), the emoji short-code map, the permalink and the access check: the 7 baseline entries.

The baseline entries and the follow-ups are in `docs/TODO.md`, "Chat core and Slack adapter: next steps". Not verified against a live Slack workspace: steps 1 to 3a change which code calls the Slack functions and who records a delivery, not the Slack calls themselves, and the existing chat tests (which mock Slack) pass.
