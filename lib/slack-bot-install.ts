import { createSlackClient } from "@/lib/slack-client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clock } from "@/lib/clock";
import { forgetSlackBotToken } from "@/lib/slack-bot-token";
import { slackRedirectUri } from "@/lib/slack-connect";
import { createRepos } from "@/lib/data/repos";

/**
 * Installing Billie Bot (the bot's token, not a member's) through Slack's OAuth flow, for an admin: the recovery
 * path when the stored rotating bot token and its refresh token are gone (docs/SECRET_ROTATION.md). A Slack app that has
 * opted into token rotation hands out its bot token, and the refresh token the Hub needs to keep it alive, only
 * through this flow: the dashboard's Reinstall button doesn't exist for it.
 *
 * /api/oauth/slack/bot/start sends an admin to Slack's approval page, and the member-connect callback
 * (/api/oauth/slack/callback, the redirect URL registered in the manifest) recognises the state this starts and
 * finishes here: trade the code for the token pair and store it, exactly as a refresh would.
 */

/** Marks the OAuth state of a bot install, so the one registered callback can tell it from a member connecting Slack. */
export const BOT_STATE_PREFIX = "bot.";

/** The bot scopes the app is configured with (slack-app-manifest.yml, oauth_config.scopes.bot); a test keeps the two equal. */
export const SLACK_BOT_SCOPES = [
  "channels:history",
  "channels:read",
  "channels:join",
  "channels:write.invites",
  "channels:manage",
  "groups:write",
  "groups:history",
  "groups:read",
  "groups:write.invites",
  "im:history",
  "im:write",
  "mpim:history",
  "mpim:read",
  "mpim:write",
  "users:read",
  "users:read.email",
  "reactions:read",
  "emoji:read",
  "files:read",
  "chat:write",
  "chat:write.customize",
  "metadata.message:read",
  "files:write",
  "commands",
] as const;

/**
 * Which workspace an install is for: "primary" (the original one; the default), "new" (a workspace not registered
 * yet: Slack's approval page lets the admin choose which one), or a Slack team id (reinstall into a registered one).
 * It travels in the OAuth state, never as a Hub id, because the admin page's URL must not carry one.
 */
export type BotInstallTarget = "primary" | "new" | (string & {});

const TARGET = /^[A-Za-z0-9]{1,32}$/;

/** The state to send Slack for an install into `target`: `bot.<target>.<random>`. */
export function botInstallState(target: BotInstallTarget, random: string): string {
  return `${BOT_STATE_PREFIX}${target}.${random}`;
}

/** The target an install state names; "primary" for the older `bot.<random>` form and for anything malformed. */
export function botInstallTarget(state: string | null): BotInstallTarget {
  const parts = (state ?? "").split(".");
  return parts.length === 3 && parts[0] === "bot" && TARGET.test(parts[1]) ? parts[1] : "primary";
}

export function isBotInstallTarget(value: string | null): value is BotInstallTarget {
  return value !== null && TARGET.test(value);
}

export function buildBotInstallUrl(state: string, teamId?: string | null): string {
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", process.env.SLACK_CLIENT_ID ?? "");
  url.searchParams.set("scope", SLACK_BOT_SCOPES.join(","));
  url.searchParams.set("redirect_uri", slackRedirectUri());
  url.searchParams.set("state", state);
  // The primary workspace is the one SLACK_TEAM_ID names; another is chosen by its team id, or in Slack for a new one.
  const team = teamId === undefined ? process.env.SLACK_TEAM_ID : teamId;
  if (team) url.searchParams.set("team", team);
  return url.toString();
}

export type BotInstallResult =
  | { ok: true; botUser: string | null; expiresAt: Date; workspaceName?: string }
  | { ok: false; reason: "wrong_workspace" | "not_rotating" | "slack" | "store" | "unknown_workspace" };

/** Trade the code Slack redirected back with for the bot's rotating token pair and store it (replacing whatever is there). */
export async function completeBotInstall(service: SupabaseClient, code: string, target: BotInstallTarget = "primary"): Promise<BotInstallResult> {
  let result;
  try {
    result = await createSlackClient().oauth.v2.access({
      client_id: process.env.SLACK_CLIENT_ID ?? "",
      client_secret: process.env.SLACK_CLIENT_SECRET ?? "",
      code,
      redirect_uri: slackRedirectUri(),
    });
  } catch (error) {
    console.error("Slack bot install: exchanging the code failed:", error);
    return { ok: false, reason: "slack" };
  }
  if (!result.ok || !result.access_token) return { ok: false, reason: "slack" };
  if (target === "primary" && process.env.SLACK_TEAM_ID && result.team?.id !== process.env.SLACK_TEAM_ID) return { ok: false, reason: "wrong_workspace" };
  // Without a refresh token the credential could never be renewed: refuse it rather than store a time bomb.
  if (!result.refresh_token || !result.expires_in) return { ok: false, reason: "not_rotating" };

  const expiresAt = new Date(clock.now() + result.expires_in * 1000);
  const tokens = { p_access_token: result.access_token, p_refresh_token: result.refresh_token, p_expires_at: expiresAt.toISOString() };

  // Which workspace this credential belongs to. The primary one keeps its original storage (and needs no lookup).
  let workspace: { id: string; name: string } | null = null;
  if (target !== "primary") {
    const teamId = result.team?.id;
    if (!teamId) return { ok: false, reason: "slack" };
    try {
      const registry = createRepos(service as never).slackWorkspaces;
      const known = await registry.byTeamId(teamId);
      if (target === "new") workspace = await registry.register({ teamId, name: result.team?.name || known?.name || teamId });
      else if (!known || known.team_id !== target) return { ok: false, reason: known ? "wrong_workspace" : "unknown_workspace" };
      else workspace = known;
    } catch (error) {
      console.error("Slack bot install: recording the workspace failed:", error);
      return { ok: false, reason: "store" };
    }
  }

  const { error } = workspace
    ? await service.rpc("slack_workspace_token_save", { p_workspace_id: workspace.id, ...tokens })
    : await service.rpc("slack_bot_token_save", tokens);
  if (error) {
    console.error("Slack bot install: storing the token failed:", error);
    return { ok: false, reason: "store" };
  }
  forgetSlackBotToken();
  return { ok: true, botUser: result.bot_user_id ?? null, expiresAt, workspaceName: workspace?.name };
}
