# Multiple Slack Workspaces

Status: **planned, not built.** Work started on a first PR and was put on hold; nothing of it is in `main`. This document records what was found and the agreed plan, so it can be picked up later. The entry in `docs/TODO.md` ("Support more than one Slack workspace") points here.

## Why

Quill & Cup has a second Slack workspace, for the 180 Program (shared with Ready Writer). Its activity should be tracked and counted in engagement like the main workspace's, in the same way Kajabi has communities. The people in it are Hub members and already exist in Kajabi.

## Decisions already made

- **Same app, installed twice.** Billie Bot is installed in both workspaces: one signing secret, one client id, a separate bot token per workspace, told apart by `team_id`.
- **Engagement is combined** across workspaces, with a workspace filter on the admin Slack engagement page.
- **Everything is in scope eventually:** matching Slack users to members, Slack sign-in and Connect, notifications, and the Hub chat bridge.
- **Second-workspace people are matched to existing members** (already in Kajabi). Phase 2 does not create members without a Kajabi record.

## Findings: Slack today assumes one workspace

Slack user, channel and team ids are only unique within a workspace. A person has a different Slack user id in each workspace (unless the workspaces sit under Enterprise Grid, which adds an org-wide `W…` id); their Hub member id and login stay the same. The member is where the accounts join.

Nothing has a workspace or `team_id` column today. The unique keys that assume global uniqueness:

- Bronze: `slack_channels` (channel id), `slack_users` (user id), `slack_files` (file id), `slack_custom_emoji` (keyed on the emoji name), `ignored_slack_users`, `restricted_slack_channels`, `slack_messages` (channel, message ts), `slack_reactions`, `slack_channel_members`, `slack_channel_member_events`.
- Downstream, keyed on a Slack user or channel id alone: `slack_identities` and `slack_sign_in_tokens` (Slack sign-in), `member_slack_connections` (unique on the Slack user), `chat_slack_authors`, `chat_reactions`, `chat_channels.slack_channel_id`, `chat_messages` (channel, Slack ts).
- Member matching: `lib/slack-matching.ts`, `lib/slack-member-ids.ts`, `lib/member-slack-links.ts`.

Other single-workspace wiring:

- **Token:** one bot token in a Vault singleton (`slack_bot_token`), read by `getSlackBotToken()` (`lib/slack-bot-token.ts`), with one refresh lease (`'bot'`; member tokens use `'member:<id>'`). Install flow: `lib/slack-bot-install.ts` and `app/api/oauth/slack/bot/start`.
- **Webhook:** `app/api/webhooks/slack` checks only the signing secret, not the team id. The import and reconcile routes use the token alone to pick the workspace.
- **Config that is global:** the workspace URL, the alerts, changelog and celebrations channel ids, the intro channel, `SLACK_TEAM_ID` (deep links). The manifest and OAuth flows describe one app.
- Data access is through `SlackWorkspaceRepository` and `SlackMessageRepository`; the guard test `tests/lib/data-access-layer.test.ts` applies.
- Kajabi has no multi-community concept to copy; this is a fresh design.

## Plan

Four PRs, merged in order.

1. **Foundation, capture and engagement.**
   - A `slack_workspaces` table (text id with the next free prefix from `docs/SHORT_IDS_PLAN.md`, unique Slack team id, name, URL, primary flag, `deleted_at`, grants per `.claude/rules/supabase-table-grants.md`). The existing workspace becomes the primary row, without real ids hardcoded in a public repo.
   - Per-workspace bot token storage and refresh lease; the install flow records the team id.
   - A workspace id on the Bronze Slack tables, existing rows backfilled to the primary workspace, keys made workspace-aware.
   - The workspace threaded through both repositories (interface, Supabase class, in-memory twin, contract suites), the webhook (resolve the workspace from the event's team id, reject unknown teams), import, reconcile and processing routes, `lib/slack-activity-projection.ts`, and `lib/slack-engagement-stats.ts` / `lib/member-engagement.ts`.
   - Tests with two workspaces whose channel and user ids collide, for idempotency and reprocessability.
2. **Matching and sign-in.** Match second-workspace Slack users to the existing Kajabi-backed members (email, then name, per workspace; manual linking for the rest). `slack_identities`, `member_slack_connections`, sign-in and Connect become per workspace: unique on (workspace, Slack user) instead of the Slack user alone.
3. **Notifications and chat bridge.** DMs go out from the right workspace (a member may be in both; decide which per kind), and the chat bridge mirrors channels per workspace.
4. **Admin UI polish.** Workspace names and filters across the Slack admin pages.

## Cautions for whoever builds it

- **Expand, then contract** (`CLAUDE.md`). Production code keeps running against the new schema during a deploy, so add the new columns and keys first and switch the code before removing the old ones. Squawk bans dropping or replacing constraints (`ban-drop-constraint` and others): each such statement needs the user's explicit approval, never an ignore added on your own.
- **Large tables.** Check production sizes read-only first (`.claude/rules/verify-against-prod.md`); `slack_messages` is big, so backfills are batched to fit the 8s statement timeout.
- **One-time step:** installing Billie Bot into the second workspace is done by a person in Slack; the code only provides the flow.
- **Slack content privacy** (service role only text, column grants on `raw_payload`) applies to every new column and table.
- Update `slack-app-manifest.yml` only through its own process (`docs/SLACK_MANIFEST.md`).
- An earlier attempt at PR 1 exists on the branch `slack-multi-workspace-1` (closed PR #1294, never merged). It was not reviewed or verified; treat it as a starting point at most.
