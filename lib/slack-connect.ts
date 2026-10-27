import { randomBytes, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { WebClient } from "@slack/web-api";
import type { SupabaseClient } from "@supabase/supabase-js";
import { APP_URL } from "@/lib/config";
import { clock } from "@/lib/clock";
import { withRefreshLease } from "@/lib/slack-token-refresh";

/**
 * Slack connect (docs/SLACK_BRIDGED_CHAT.md, "Hub -> Slack"): a member connects their own Slack
 * account so the Hub can act as them (post natively, react) instead of through the bot. The
 * OAuth flow is app/api/oauth/slack/{start,callback}; the tokens live in Supabase Vault, behind
 * the slack_connection_* functions (service role only).
 */

/**
 * What the Hub asks to do as the member. Posting and reacting; and sharing read state: the *:read
 * scopes let it see how far they have read in each conversation, the *:write ones let it move
 * Slack's marker when they read in the Hub (conversations.mark takes the write scopes).
 * More (leaving channels) comes with invite/kick.
 */
export const SLACK_USER_SCOPES = [
  "chat:write",
  "reactions:write",
  "channels:read",
  "groups:read",
  "mpim:read",
  "channels:write",
  "groups:write",
  "mpim:write",
  // Sending files from the Hub as the member (lib/chat/slack-upload.ts); without it the bot uploads.
  "files:write",
];

/** Whether a stored connection predates read sync and needs to be reconnected to share read state. */
export const hasReadSyncScopes = (scopes: string[]): boolean => SLACK_USER_SCOPES.every((s) => scopes.includes(s));

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

export type LinkResult =
  | { ok: true; replaced: string[] }
  | { ok: false; reason: "wrong_workspace" | "taken" | "other_account" };

/**
 * Binds the Slack account that just approved to the signed-in member. Slack's OAuth shows they
 * control that Slack account and their Hub session shows the Hub one, so the binding needs no name
 * or email match, and it outranks every other kind (email_match, email_alias, admin): those are
 * inferences, this is a proof. It replaces them, loudly, and the matcher follows it
 * (lib/slack-matching.ts). Refused only when the Slack account is in another workspace, is already
 * connected by a different member (a real dispute for an admin), or this member already connected a
 * different Slack account.
 */
export async function linkSlackAccount(service: SupabaseClient, grant: SlackGrant, memberId: string, authUserId: string): Promise<LinkResult> {
  const team = process.env.SLACK_TEAM_ID;
  if (team && grant.teamId !== team) return { ok: false, reason: "wrong_workspace" };

  const [{ data: held }, { data: bySlack }, { data: byUser }] = await Promise.all([
    service.from("member_slack_connections").select("member_id").eq("slack_user_id", grant.slackUserId).neq("member_id", memberId).limit(1),
    service.from("slack_identities").select("user_id, linked_via").eq("slack_user_id", grant.slackUserId).maybeSingle(),
    service.from("slack_identities").select("slack_user_id, linked_via").eq("user_id", authUserId).maybeSingle(),
  ]);
  if ((held?.length ?? 0) > 0 || (bySlack && bySlack.user_id !== authUserId && bySlack.linked_via === "slack_connect")) {
    return { ok: false, reason: "taken" };
  }
  if (byUser && byUser.slack_user_id !== grant.slackUserId && byUser.linked_via === "slack_connect") {
    return { ok: false, reason: "other_account" };
  }

  const replaced: string[] = [];
  if (bySlack && bySlack.user_id !== authUserId) {
    const { error } = await service.from("slack_identities").delete().eq("slack_user_id", grant.slackUserId);
    if (error) throw error;
    replaced.push(`${bySlack.linked_via} (another account)`);
  }
  if (byUser && byUser.slack_user_id !== grant.slackUserId) {
    const { error } = await service.from("slack_identities").delete().eq("user_id", authUserId);
    if (error) throw error;
    replaced.push(`${byUser.linked_via} (another Slack user)`);
  }
  const { error } = await service
    .from("slack_identities")
    .upsert({ slack_user_id: grant.slackUserId, user_id: authUserId, linked_via: "slack_connect" }, { onConflict: "slack_user_id" });
  if (error) throw error;
  if (replaced.length > 0) console.error("slack-connect: a verified link replaced %s for member %s", replaced.join(", "), memberId);
  return { ok: true, replaced };
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
  /** Connected with every scope read sync needs; false for a connection made before it existed. */
  sharesReadState: boolean;
  /** Had a connection that Slack stopped honouring (revoked by us when its token died), so it needs reconnecting rather than connecting. */
  revoked: boolean;
}

/** Whether the member has an active connection (the row, never the tokens). */
export async function getSlackConnectionStatus(service: SupabaseClient, memberId: string): Promise<SlackConnectionStatus> {
  const { data } = await service
    .from("member_slack_connections")
    .select("slack_user_id, connected_at, revoked_at, scopes")
    .eq("member_id", memberId)
    .maybeSingle();
  const connected = Boolean(data && !data.revoked_at);
  return {
    connected,
    slackUserId: connected ? data!.slack_user_id : null,
    connectedAt: connected ? data!.connected_at : null,
    sharesReadState: connected && hasReadSyncScopes((data!.scopes as string[] | null) ?? []),
    revoked: Boolean(data?.revoked_at),
  };
}

/** Refresh a rotating token when it has less than this left. */
const REFRESH_WITHIN_MS = 5 * 60 * 1000;

interface ConnectionRow {
  slack_user_id: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
}

async function readConnection(service: SupabaseClient, memberId: string): Promise<ConnectionRow | null> {
  const { data, error } = await service.rpc("slack_connection_tokens", { p_member: memberId });
  const row = (Array.isArray(data) ? data[0] : data) as ConnectionRow | undefined;
  return error || !row ? null : row;
}

const isExpiring = (row: ConnectionRow): boolean => row.expires_at !== null && Date.parse(row.expires_at) - clock.now() < REFRESH_WITHIN_MS;
const hasNotExpired = (row: ConnectionRow): boolean => row.expires_at === null || Date.parse(row.expires_at) - clock.now() > 60 * 1000;
const asToken = (row: ConnectionRow) => ({ token: row.access_token, slackUserId: row.slack_user_id });

/**
 * The member's Slack user token, ready to use, or null when they haven't connected or the
 * connection no longer works. Refreshes a rotating (expiring) token first, under a lease so two requests
 * never refresh one token at once (Slack refresh tokens are single-use: the second would be refused and
 * the member asked to reconnect; lib/slack-token-refresh.ts); a refresh Slack refuses revokes the
 * connection so the member is asked to reconnect instead of failing silently.
 */
export async function getSlackUserToken(service: SupabaseClient, memberId: string): Promise<{ token: string; slackUserId: string } | null> {
  const row = await readConnection(service, memberId);
  if (!row) return null;
  if (!isExpiring(row)) return asToken(row);
  if (!row.refresh_token) {
    await service.rpc("slack_connection_revoke", { p_member: memberId });
    return null;
  }

  try {
    return await withRefreshLease<ReturnType<typeof asToken> | null>(service, `member:${memberId}`, {
      fallback: hasNotExpired(row) ? asToken(row) : null,
      reread: async () => {
        const again = await readConnection(service, memberId);
        return again && !isExpiring(again) ? asToken(again) : null;
      },
      refresh: async () => {
        // Read again now that this request holds the lease: another may have refreshed (spending the refresh
        // token read above), or the member may have disconnected, in between.
        const latest = await readConnection(service, memberId);
        if (!latest) return null;
        if (!isExpiring(latest)) return asToken(latest);
        try {
          const result = await new WebClient().oauth.v2.access({
            client_id: process.env.SLACK_CLIENT_ID ?? "",
            client_secret: process.env.SLACK_CLIENT_SECRET ?? "",
            grant_type: "refresh_token",
            refresh_token: latest.refresh_token ?? "",
          });
          const access = result.access_token ?? result.authed_user?.access_token;
          if (!result.ok || !access) throw new Error("Slack did not return a refreshed token");
          await service.rpc("slack_connection_update_tokens", {
            p_member: memberId,
            p_access_token: access,
            p_refresh_token: result.refresh_token ?? result.authed_user?.refresh_token ?? null,
            p_expires_at: expiryFrom(result.expires_in ?? result.authed_user?.expires_in),
          });
          return { token: access, slackUserId: latest.slack_user_id };
        } catch (error) {
          console.error("Slack token refresh failed for member %s:", memberId, error);
          await service.rpc("slack_connection_revoke", { p_member: memberId });
          return null;
        }
      },
    });
  } catch (error) {
    // Couldn't coordinate (the database): not a reason to disconnect anyone. Use what works, if anything.
    console.error("Slack token refresh lease failed for member %s:", memberId, error);
    return hasNotExpired(row) ? asToken(row) : null;
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
