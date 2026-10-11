import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useFakeClock } from "@/tests/helpers/fake-clock";

const access = vi.fn();
vi.mock("@slack/web-api", () => ({
  WebClient: vi.fn(function () {
    return { oauth: { v2: { access } }, auth: { revoke: vi.fn(async () => ({ ok: true })) } };
  }),
}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

import { APP_URL } from "@/lib/config";
import {
  buildSlackAuthorizeUrl,
  disconnectSlack,
  exchangeSlackCode,
  getSlackUserToken,
  isDeadTokenError,
  isSlackConnectConfigured,
  slackRedirectUri,
  slackUserIsMember,
} from "@/lib/slack-connect";

const NOW = Date.parse("2026-10-10T12:00:00Z");

/** A Supabase stand-in: rpc by name, and single-row reads by table. */
function fakeService(opts: { tokens?: Record<string, unknown> | null; rows?: Record<string, unknown> } = {}) {
  const rpc = vi.fn(async (name: string) => {
    if (name === "slack_connection_tokens") return { data: opts.tokens ? [opts.tokens] : [], error: null };
    return { data: null, error: null };
  });
  const from = (table: string) => {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.maybeSingle = async () => ({ data: opts.rows?.[table] ?? null });
    return chain;
  };
  return { rpc, from } as never as import("@supabase/supabase-js").SupabaseClient & { rpc: typeof rpc };
}

beforeEach(() => {
  access.mockReset();
  vi.stubEnv("SLACK_CLIENT_ID", "client-1");
  vi.stubEnv("SLACK_CLIENT_SECRET", "secret-1");
  vi.stubEnv("SLACK_TEAM_ID", "T_TEAM");
});
afterEach(() => vi.unstubAllEnvs());

describe("configuration and the authorize URL", () => {
  it("is on only with both the client ID and secret", () => {
    expect(isSlackConnectConfigured()).toBe(true);
    vi.stubEnv("SLACK_CLIENT_SECRET", "");
    expect(isSlackConnectConfigured()).toBe(false);
  });

  it("asks for the user scopes, returns to the registered callback and carries the state", () => {
    const url = new URL(buildSlackAuthorizeUrl("state-1"));
    expect(url.origin + url.pathname).toBe("https://slack.com/oauth/v2/authorize");
    expect(url.searchParams.get("client_id")).toBe("client-1");
    expect(url.searchParams.get("user_scope")).toBe("chat:write,reactions:write");
    expect(url.searchParams.get("redirect_uri")).toBe(`${APP_URL}/api/oauth/slack/callback`);
    expect(slackRedirectUri()).toBe(`${APP_URL}/api/oauth/slack/callback`);
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("team")).toBe("T_TEAM");
  });
});

describe("exchangeSlackCode", () => {
  useFakeClock(() => NOW);

  it("returns the member's user token, with an expiry when Slack rotates tokens", async () => {
    access.mockResolvedValue({
      ok: true,
      team: { id: "T_TEAM" },
      authed_user: { id: "U_FERN", access_token: "xoxp-1", scope: "chat:write,reactions:write", refresh_token: "xoxe-1", expires_in: 3600 },
    });
    await expect(exchangeSlackCode("code-1")).resolves.toEqual({
      slackUserId: "U_FERN",
      teamId: "T_TEAM",
      accessToken: "xoxp-1",
      refreshToken: "xoxe-1",
      expiresAt: new Date(NOW + 3600_000).toISOString(),
      scopes: ["chat:write", "reactions:write"],
    });
    expect(access).toHaveBeenCalledWith(expect.objectContaining({ code: "code-1", client_id: "client-1", redirect_uri: slackRedirectUri() }));
  });

  it("has no expiry for a token that doesn't rotate, and refuses a response without a user token", async () => {
    access.mockResolvedValueOnce({ ok: true, authed_user: { id: "U_FERN", access_token: "xoxp-1", scope: "chat:write" } });
    await expect(exchangeSlackCode("c")).resolves.toMatchObject({ refreshToken: null, expiresAt: null });
    access.mockResolvedValueOnce({ ok: true, authed_user: { id: "U_FERN" } });
    await expect(exchangeSlackCode("c")).rejects.toThrow("user token");
  });
});

describe("slackUserIsMember", () => {
  it("accepts the Slack user already matched to the member, or the one their account signs in as", async () => {
    expect(await slackUserIsMember(fakeService({ rows: { chat_slack_authors: { member_id: "m1" } } }), "U1", "m1", "auth-1")).toBe(true);
    expect(await slackUserIsMember(fakeService({ rows: { slack_identities: { user_id: "auth-1" } } }), "U1", "m1", "auth-1")).toBe(true);
  });

  it("refuses a Slack account matched to someone else, or to no one", async () => {
    expect(await slackUserIsMember(fakeService({ rows: { chat_slack_authors: { member_id: "other" } } }), "U1", "m1", "auth-1")).toBe(false);
    expect(await slackUserIsMember(fakeService(), "U1", "m1", "auth-1")).toBe(false);
  });
});

describe("getSlackUserToken", () => {
  useFakeClock(() => NOW);
  const row = (extra: Record<string, unknown> = {}) => ({
    slack_user_id: "U_FERN",
    access_token: "xoxp-old",
    refresh_token: "xoxe-old",
    expires_at: null,
    ...extra,
  });

  it("is null without a connection", async () => {
    await expect(getSlackUserToken(fakeService({ tokens: null }), "m1")).resolves.toBeNull();
  });

  it("returns a token that doesn't expire, or isn't close to it, as it is", async () => {
    await expect(getSlackUserToken(fakeService({ tokens: row() }), "m1")).resolves.toEqual({ token: "xoxp-old", slackUserId: "U_FERN" });
    const later = new Date(NOW + 3600_000).toISOString();
    await expect(getSlackUserToken(fakeService({ tokens: row({ expires_at: later }) }), "m1")).resolves.toMatchObject({ token: "xoxp-old" });
    expect(access).not.toHaveBeenCalled();
  });

  it("refreshes a token about to expire and stores the new ones", async () => {
    access.mockResolvedValue({ ok: true, access_token: "xoxp-new", refresh_token: "xoxe-new", expires_in: 43200 });
    const service = fakeService({ tokens: row({ expires_at: new Date(NOW + 60_000).toISOString() }) });

    await expect(getSlackUserToken(service, "m1")).resolves.toEqual({ token: "xoxp-new", slackUserId: "U_FERN" });
    expect(access).toHaveBeenCalledWith(expect.objectContaining({ grant_type: "refresh_token", refresh_token: "xoxe-old" }));
    expect(service.rpc).toHaveBeenCalledWith("slack_connection_update_tokens", {
      p_member: "m1",
      p_access_token: "xoxp-new",
      p_refresh_token: "xoxe-new",
      p_expires_at: new Date(NOW + 43200_000).toISOString(),
    });
  });

  it("revokes the connection when the refresh fails or there is nothing to refresh with", async () => {
    access.mockRejectedValue(new Error("invalid_refresh_token"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const expiring = new Date(NOW + 60_000).toISOString();

    const failing = fakeService({ tokens: row({ expires_at: expiring }) });
    await expect(getSlackUserToken(failing, "m1")).resolves.toBeNull();
    expect(failing.rpc).toHaveBeenCalledWith("slack_connection_revoke", { p_member: "m1" });

    const noRefresh = fakeService({ tokens: row({ expires_at: expiring, refresh_token: null }) });
    await expect(getSlackUserToken(noRefresh, "m1")).resolves.toBeNull();
    expect(noRefresh.rpc).toHaveBeenCalledWith("slack_connection_revoke", { p_member: "m1" });
  });
});

describe("disconnectSlack and dead tokens", () => {
  it("revokes the stored connection", async () => {
    const service = fakeService({ tokens: { slack_user_id: "U", access_token: "xoxp", refresh_token: null, expires_at: null } });
    await disconnectSlack(service, "m1");
    expect(service.rpc).toHaveBeenCalledWith("slack_connection_revoke", { p_member: "m1" });
  });

  it("recognises Slack's dead-token errors", () => {
    expect(isDeadTokenError({ data: { error: "token_revoked" } })).toBe(true);
    expect(isDeadTokenError({ data: { error: "channel_not_found" } })).toBe(false);
    expect(isDeadTokenError(new Error("boom"))).toBe(false);
  });
});
