import { randomBytes, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { WebClient } from "@slack/web-api";
import type { SupabaseClient } from "@supabase/supabase-js";
import { APP_URL } from "@/lib/config";
import { clock } from "@/lib/clock";

/**
 * Slack connect (docs/SLACK_BRIDGED_CHAT.md, "Hub -> Slack"): a member connects their own Slack
 * account so the Hub can act as them (post natively, react) instead of through the bot. The
 * OAuth flow is app/api/oauth/slack/{start,callback}; the tokens live in Supabase Vault, behind
 * the slack_connection_* functions (service role only).
 */

/** What the Hub asks to do as the member. More (leaving channels) comes with invite/kick. */
export const SLACK_USER_SCOPES = ["chat:write", "reactions:write"];

/** Registered as a redirect URL in slack-app-manifest.yml; Slack requires an exact match. */
export const SLACK_REDIRECT_PATH = "/api/oauth/slack/callback";
export const slackRedirectUri = () => `${APP_URL}${SLACK_REDIRECT_PATH}`;

/** Off until the Slack app's client ID and secret are in the environment, so a deploy never breaks without them. */
export function isSlackConnectConfigured(): boolean {
  return Boolean(process.env.SLACK_CLIENT_ID && process.env.SLACK_CLIENT_SECRET);
}

export function buildSlackAuthorizeUrl(state: string): string {
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", process.env.SLACK_CLIENT_ID ?? "");
  url.searchParams.set("user_scope", SLACK_USER_SCOPES.join(","));
  url.searchParams.set("redirect_uri", slackRedirectUri());
  url.searchParams.set("state", state);
  if (process.env.SLACK_TEAM_ID) url.searchParams.set("team", process.env.SLACK_TEAM_ID);
  return url.toString();
}

const STATE_COOKIE = "slack_connect_state";
const STATE_MAX_AGE_SECONDS = 10 * 60;

/** A random state, remembered in a short-lived cookie so the callback can tell the flow started here. */
export async function setConnectStateCookie(): Promise<string> {
  const state = randomBytes(32).toString("hex");
  (await cookies()).set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/oauth/slack",
    maxAge: STATE_MAX_AGE_SECONDS,
  });
  return state;
}

/** Whether `state` is the one this browser was given; the cookie is spent either way. */
export async function consumeConnectStateCookie(state: string | null): Promise<boolean> {
  const jar = await cookies();
  const expected = jar.get(STATE_COOKIE)?.value;
  jar.delete({ name: STATE_COOKIE, path: "/api/oauth/slack" });
  if (!state || !expected || state.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(state), Buffer.from(expected));
}

export interface SlackGrant {
  slackUserId: string;
  teamId: string | null;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  scopes: string[];
}

const expiryFrom = (expiresIn?: number): string | null =>
  expiresIn ? new Date(clock.now() + expiresIn * 1000).toISOString() : null;

/** Trades the code Slack redirected back with for the member's user token. */
export async function exchangeSlackCode(code: string): Promise<SlackGrant> {
  const result = await new WebClient().oauth.v2.access({
    client_id: process.env.SLACK_CLIENT_ID ?? "",
    client_secret: process.env.SLACK_CLIENT_SECRET ?? "",
    code,
    redirect_uri: slackRedirectUri(),
  });
  const user = result.authed_user;
  if (!result.ok || !user?.id || !user.access_token) throw new Error("Slack did not return a user token");
  return {
    slackUserId: user.id,
    teamId: result.team?.id ?? null,
    accessToken: user.access_token,
    refreshToken: user.refresh_token ?? null,
    expiresAt: expiryFrom(user.expires_in),
    scopes: (user.scope ?? "").split(",").filter(Boolean),
  };
}

/**
 * Whether this Slack user is the member: the Slack user the Hub already matched to them, or the one
 * their account signs in from Slack as. A connection to anyone else's Slack account is refused, so
 * what the Hub posts "as" a member is always that member.
 */
export async function slackUserIsMember(service: SupabaseClient, slackUserId: string, memberId: string, authUserId: string): Promise<boolean> {
  const [{ data: matched }, { data: identity }] = await Promise.all([
    service.from("chat_slack_authors").select("member_id").eq("slack_user_id", slackUserId).maybeSingle(),
    service.from("slack_identities").select("user_id").eq("slack_user_id", slackUserId).maybeSingle(),
  ]);
  return matched?.member_id === memberId || identity?.user_id === authUserId;
}

export async function saveSlackConnection(service: SupabaseClient, memberId: string, grant: SlackGrant): Promise<void> {
  const { error } = await service.rpc("slack_connection_save", {
    p_member: memberId,
    p_slack_user_id: grant.slackUserId,
    p_team_id: grant.teamId,
    p_scopes: grant.scopes,
    p_access_token: grant.accessToken,
    p_refresh_token: grant.refreshToken,
    p_expires_at: grant.expiresAt,
  });
  if (error) throw error;
}

export interface SlackConnectionStatus {
  connected: boolean;
  slackUserId: string | null;
  connectedAt: string | null;
}

/** Whether the member has an active connection (the row, never the tokens). */
export async function getSlackConnectionStatus(service: SupabaseClient, memberId: string): Promise<SlackConnectionStatus> {
  const { data } = await service
    .from("member_slack_connections")
    .select("slack_user_id, connected_at, revoked_at")
    .eq("member_id", memberId)
    .maybeSingle();
  const connected = Boolean(data && !data.revoked_at);
  return { connected, slackUserId: connected ? data!.slack_user_id : null, connectedAt: connected ? data!.connected_at : null };
}

/** Refresh a rotating token when it has less than this left. */
const REFRESH_WITHIN_MS = 5 * 60 * 1000;

/**
 * The member's Slack user token, ready to use, or null when they haven't connected or the
 * connection no longer works. Refreshes a rotating (expiring) token first; a refresh Slack
 * refuses revokes the connection so the member is asked to reconnect instead of failing silently.
 */
export async function getSlackUserToken(service: SupabaseClient, memberId: string): Promise<{ token: string; slackUserId: string } | null> {
  const { data, error } = await service.rpc("slack_connection_tokens", { p_member: memberId });
  const row = (Array.isArray(data) ? data[0] : data) as
    | { slack_user_id: string; access_token: string; refresh_token: string | null; expires_at: string | null }
    | undefined;
  if (error || !row) return null;

  const expiring = row.expires_at !== null && Date.parse(row.expires_at) - clock.now() < REFRESH_WITHIN_MS;
  if (!expiring) return { token: row.access_token, slackUserId: row.slack_user_id };
  if (!row.refresh_token) {
    await service.rpc("slack_connection_revoke", { p_member: memberId });
    return null;
  }

  try {
    const result = await new WebClient().oauth.v2.access({
      client_id: process.env.SLACK_CLIENT_ID ?? "",
      client_secret: process.env.SLACK_CLIENT_SECRET ?? "",
      grant_type: "refresh_token",
      refresh_token: row.refresh_token,
    });
    const access = result.access_token ?? result.authed_user?.access_token;
    if (!result.ok || !access) throw new Error("Slack did not return a refreshed token");
    await service.rpc("slack_connection_update_tokens", {
      p_member: memberId,
      p_access_token: access,
      p_refresh_token: result.refresh_token ?? result.authed_user?.refresh_token ?? null,
      p_expires_at: expiryFrom(result.expires_in ?? result.authed_user?.expires_in),
    });
    return { token: access, slackUserId: row.slack_user_id };
  } catch (error) {
    console.error("Slack token refresh failed for member %s:", memberId, error);
    await service.rpc("slack_connection_revoke", { p_member: memberId });
    return null;
  }
}

/** Slack errors that mean the user token is dead (revoked, app uninstalled, account deactivated). */
export const DEAD_TOKEN_ERRORS = ["token_revoked", "invalid_auth", "account_inactive", "token_expired", "not_authed"];

export function isDeadTokenError(error: unknown): boolean {
  const code = (error as { data?: { error?: string } } | null)?.data?.error;
  return typeof code === "string" && DEAD_TOKEN_ERRORS.includes(code);
}

/** Disconnect: tell Slack to revoke the token (best effort), then delete it here. */
export async function disconnectSlack(service: SupabaseClient, memberId: string): Promise<void> {
  const connection = await getSlackUserToken(service, memberId);
  if (connection) {
    await new WebClient(connection.token).auth.revoke().catch((error) => console.error("auth.revoke failed:", error));
  }
  const { error } = await service.rpc("slack_connection_revoke", { p_member: memberId });
  if (error) throw error;
}
