import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";

const { getCurrentUser, getEffectiveIdentity, hasFeature, setConnectStateCookie, consumeConnectStateCookie, exchangeSlackCode, slackUserIsMember, saveSlackConnection } =
  vi.hoisted(() => ({
    getCurrentUser: vi.fn(),
    getEffectiveIdentity: vi.fn(),
    hasFeature: vi.fn(),
    setConnectStateCookie: vi.fn(async () => "state-1"),
    consumeConnectStateCookie: vi.fn(async () => true),
    exchangeSlackCode: vi.fn(),
    slackUserIsMember: vi.fn(),
    saveSlackConnection: vi.fn(),
  }));
vi.mock("@/lib/auth", () => ({ getCurrentUser }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity }));
vi.mock("@/lib/features.server", () => ({
  getUserFeaturePreviews: vi.fn(async () => []),
  effectiveMemberHasFeature: (...args: unknown[]) => hasFeature(...args),
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));

vi.mock("@/lib/slack-connect", async (original) => ({
  ...(await original<typeof import("@/lib/slack-connect")>()),
  setConnectStateCookie: () => setConnectStateCookie(),
  consumeConnectStateCookie: (...a: unknown[]) => consumeConnectStateCookie(...(a as [])),
  exchangeSlackCode: (...a: unknown[]) => exchangeSlackCode(...a),
  slackUserIsMember: (...a: unknown[]) => slackUserIsMember(...a),
  saveSlackConnection: (...a: unknown[]) => saveSlackConnection(...a),
}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

import { GET as start } from "@/app/api/oauth/slack/start/route";
import { GET as callback } from "@/app/api/oauth/slack/callback/route";

const request = (path: string) => {
  const url = new URL(`https://hub.example.test${path}`);
  return { nextUrl: url, url: url.toString() } as unknown as NextRequest;
};
const location = (res: Response) => res.headers.get("location") ?? "";

beforeEach(() => {
  vi.stubEnv("SLACK_CLIENT_ID", "client-1");
  vi.stubEnv("SLACK_CLIENT_SECRET", "secret-1");
  getCurrentUser.mockResolvedValue({ id: "auth-1", email: "fern@example.test" });
  getEffectiveIdentity.mockResolvedValue({ memberId: "m1", isSudo: false });
  hasFeature.mockResolvedValue(true);
  consumeConnectStateCookie.mockResolvedValue(true);
  slackUserIsMember.mockResolvedValue(true);
  exchangeSlackCode.mockResolvedValue({ slackUserId: "U_FERN", accessToken: "xoxp-1" });
  for (const fn of [setConnectStateCookie, exchangeSlackCode, saveSlackConnection]) fn.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/oauth/slack/start", () => {
  it("sends a signed-in member with the preview to Slack with a fresh state", async () => {
    const res = await start(request("/api/oauth/slack/start"));
    expect(location(res)).toContain("https://slack.com/oauth/v2/authorize");
    expect(location(res)).toContain("state=state-1");
    expect(setConnectStateCookie).toHaveBeenCalled();
  });

  it("sends visitors who are signed out to login, and everyone else back to settings with a reason", async () => {
    getCurrentUser.mockResolvedValueOnce(null);
    expect(location(await start(request("/api/oauth/slack/start")))).toBe("https://hub.example.test/login");

    getEffectiveIdentity.mockResolvedValueOnce({ memberId: "m1", isSudo: true });
    expect(location(await start(request("/api/oauth/slack/start")))).toBe("https://hub.example.test/settings?slack=sudo");

    vi.stubEnv("SLACK_CLIENT_SECRET", "");
    expect(location(await start(request("/api/oauth/slack/start")))).toBe("https://hub.example.test/settings?slack=unavailable");
    vi.stubEnv("SLACK_CLIENT_SECRET", "secret-1");

    hasFeature.mockResolvedValueOnce(false);
    expect(location(await start(request("/api/oauth/slack/start")))).toBe("https://hub.example.test/settings?slack=unavailable");
    expect(setConnectStateCookie).not.toHaveBeenCalled();
  });
});

describe("GET /api/oauth/slack/callback", () => {
  const ok = "/api/oauth/slack/callback?code=code-1&state=state-1";

  it("stores the token for the signed-in member when their own Slack account approved", async () => {
    const res = await callback(request(ok));
    expect(location(res)).toBe("https://hub.example.test/settings?slack=connected");
    expect(exchangeSlackCode).toHaveBeenCalledWith("code-1");
    expect(saveSlackConnection).toHaveBeenCalledWith(expect.anything(), "m1", expect.objectContaining({ slackUserId: "U_FERN" }));
  });

  it("refuses a Slack account that isn't the member's, without storing anything", async () => {
    slackUserIsMember.mockResolvedValue(false);
    expect(location(await callback(request(ok)))).toBe("https://hub.example.test/settings?slack=wrong_account");
    expect(saveSlackConnection).not.toHaveBeenCalled();
  });

  it("refuses a state that doesn't match this browser's, before talking to Slack", async () => {
    consumeConnectStateCookie.mockResolvedValue(false);
    expect(location(await callback(request(ok)))).toBe("https://hub.example.test/settings?slack=invalid_state");
    expect(exchangeSlackCode).not.toHaveBeenCalled();
  });

  it("handles a member who declined, sudo, a signed-out visitor and a Slack failure", async () => {
    expect(location(await callback(request("/api/oauth/slack/callback?error=access_denied&state=state-1")))).toContain("slack=declined");

    getEffectiveIdentity.mockResolvedValueOnce({ memberId: "m1", isSudo: true });
    expect(location(await callback(request(ok)))).toContain("slack=sudo");

    getCurrentUser.mockResolvedValueOnce(null);
    expect(location(await callback(request(ok)))).toBe("https://hub.example.test/login");

    vi.spyOn(console, "error").mockImplementation(() => {});
    exchangeSlackCode.mockRejectedValueOnce(new Error("invalid_code"));
    expect(location(await callback(request(ok)))).toContain("slack=failed");
    expect(saveSlackConnection).not.toHaveBeenCalled();
  });
});
