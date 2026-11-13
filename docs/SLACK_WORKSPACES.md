# Slack workspaces

Quill & Cup has more than one Slack workspace (the original one, and the 180 Program workspace it shares with another
organisation). The same Billie Bot app is installed in each: one signing secret, one client id, a distinct bot token per
workspace, told apart by Slack's `team_id`. The Hub captures every workspace into Bronze and counts them in engagement,
like Kajabi "communities".

This is built in four steps; this page says what step 1 (foundation, capture, engagement) did and what is left.

## What step 1 did

- **`slack_workspaces`** (id prefix `slws_`, Tier 2: never in a URL, link or export). One row per workspace: Slack team id
  (unique, external), name, url, `is_primary`, soft delete. Exactly one live primary: the workspace that existed before
  there were workspaces. `SlackWorkspaceRegistry` (`lib/data/slack-workspaces.ts`, `repos.slackWorkspaces`): list, find by
  id or team id, register, record the primary's team id.
- **The primary row is seeded without a team id.** The repo is public, so the migration holds no workspace ids. The first
  call that needs it records `SLACK_TEAM_ID` (already the environment's name for this workspace): `ensurePrimaryWorkspace`
  and `resolveWebhookWorkspace` in `lib/slack-workspaces.ts`. Nothing else to run by hand.
- **`workspace_id` on every Bronze Slack table** (`slack_channels`, `slack_users`, `slack_messages`, `slack_reactions`,
  `slack_channel_members`, `slack_channel_member_events`, `slack_custom_emoji`, `slack_files`) **and the two Local lists**
  (`ignored_slack_users`, `restricted_slack_channels`). NOT NULL, defaulting to `primary_slack_workspace_id()`, so existing
  rows are the primary workspace's and code that does not name a workspace keeps working. The metadata view
  `bronze.slack_messages_meta` carries it, and it is a granted column where columns are granted one by one (privacy rules
  unchanged: text, files and raw payloads stay service role only).
- **Workspace-aware unique indexes** next to the old keys (`(workspace_id, channel_id)` and so on).
- **Scoped repositories.** `createRepos(db, { slackWorkspaceId })` (and `createInMemoryRepos`) scope the Slack repositories
  (`slackUsers`, `slackWorkspace`, `slackMessages`) to one workspace: reads see only its rows, writes stamp it and upsert on
  `(workspace, Slack id)`. Without the option, reads see every workspace and writes land in the primary one. A Slack id is
  unique only within a workspace; never key something across workspaces by a bare Slack id.
- **Per-workspace bot token.** `getSlackBotToken(service, workspace?)` (`lib/slack-bot-token.ts`): no workspace, or the
  primary, means the original storage (`slack_bot_token`, lease key `bot`); another workspace uses
  `slack_workspace_tokens` (Vault secrets, lease key `bot:<workspace id>`) through `slack_workspace_token_get/save`, which
  also route the primary to the original storage. One cache per workspace.
- **Installing the bot into a workspace.** `/api/oauth/slack/bot/start?workspace=primary|new|<Slack team id>`: `new` lets
  the admin pick the workspace on Slack's approval page and registers it; a team id reinstalls into a registered one. The
  choice rides in the OAuth state (`bot.<target>.<random>`), never as a Hub id.
- **Webhook.** `/api/webhooks/slack` resolves the workspace from the event's `team_id` and files everything under it; an
  unregistered team (or none) is refused with 200 (so Slack does not retry) and nothing is stored.
- **Import.** `POST /api/import/slack-api` takes `workspace` (a Slack team id, default `primary`): one workspace per request
  so each has the whole time budget. `triggerSlackSync` (the nightly reconcile, the admin button) runs every registered
  workspace that has a team id, one after the other, and raises a failure only after trying them all.
- **Engagement is combined**, with a workspace filter on `/admin/insights/slack-engagement` (`?workspace=<team id>`; the
  filter is links, "All workspaces" first). Channels that share a Slack id in two workspaces stay apart (`qualifyByWorkspace`)
  and carry the workspace in their name.

## Contract step (needs approval)

CI pushes migrations before the code deploys, so step 1 only added things. Two workspaces cannot hold the *same* Slack id
until the old single-workspace keys go, and the `workspace_id` default can only go once every writer names its workspace.
The statements (squawk bans each; they need the owner's approval, see `CLAUDE.md`, "Migrations: expand, then contract"):

```sql
alter table bronze.slack_channels drop constraint slack_channels_channel_id_key;          -- UNIQUE (channel_id)
alter table bronze.slack_users drop constraint slack_users_user_id_key;                    -- UNIQUE (user_id)
alter table bronze.slack_channel_member_events drop constraint slack_channel_member_events_channel_id_user_id_event_occurr_key;
drop index bronze.idx_slack_messages_unique;                                               -- (channel_id, message_ts)
drop index bronze.idx_slack_reactions_unique;                                              -- (channel_id, message_ts, reaction, user_id)
-- primary keys that are the Slack id (a new primary key on (workspace_id, ...) first):
--   bronze.slack_channel_members (channel_id, user_id), bronze.slack_custom_emoji (name), bronze.slack_files (file_id),
--   public.ignored_slack_users (user_id), public.restricted_slack_channels (channel_id)
alter table ... alter column workspace_id drop default;  -- and drop primary_slack_workspace_id() last
```

Do it in a second PR after step 1 has deployed and every writer is scoped (see the list in `docs/TODO.md`, "Slack workspaces").
The db contract test (`tests/api/data/slack-workspaces-repository.test.ts`) turns `idsMayCollide` on then; the in-memory twin
already allows it.

## Not done yet

See `docs/TODO.md`, "Slack workspaces", for steps 2 to 4 and the loose ends.
