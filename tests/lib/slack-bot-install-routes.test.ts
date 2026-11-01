import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";

const { requireAdmin, setConnectStateCookie, consumeConnectStateCookie, completeBotInstall } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  setConnectStateCookie: vi.fn(async (_prefix?: string) => "bot.state-1"),
  consumeConnectStateCookie: vi.fn(async () => true),
  completeBotInstall: vi.fn(),
}));
vi.mock("@/lib/supabase/api-auth", () => ({ requireAdmin }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));
vi.mock("@/lib/slack-connect", async (original) => ({
  ...(await original<typeof import("@/lib/slack-connect")>()),
  setConnectStateCookie: (prefix?: string) => setConnectStateCookie(prefix),
  consumeConnectStateCookie: (...a: unknown[]) => consumeConnectStateCookie(...(a as [])),
}));
vi.mock("@/lib/slack-bot-install", async (original) => ({
  ...(await original<typeof import("@/lib/slack-bot-install")>()),
  completeBotInstall: (...a: unknown[]) => completeBotInstall(...a),
}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

import { GET as start } from "@/app/api/oauth/slack/bot/start/route";
import { GET as callback } from "@/app/api/oauth/slack/callback/route";

const request = (path: string) => {
  const url = new URL(`https://hub.example.test${path}`);
  return { nextUrl: url, url: url.toString() } as unknown as NextRequest;
};
const ok = "/api/oauth/slack/callback?code=code-1&state=bot.state-1";

beforeEach(() => {
  vi.stubEnv("SLACK_CLIENT_ID", "client-1");
  vi.stubEnv("SLACK_CLIENT_SECRET", "secret-1");
  requireAdmin.mockResolvedValue({ user: { id: "a1" }, forbidden: false });
  consumeConnectStateCookie.mockResolvedValue(true);
  completeBotInstall.mockResolvedValue({ ok: true, botUser: "U_BOT", expiresAt: new Date("2026-11-02T00:00:00Z") });
  setConnectStateCookie.mockClear();
  completeBotInstall.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/oauth/slack/bot/start", () => {
  it("sends an admin to Slack for the bot scopes, with a bot-prefixed state", async () => {
    const res = await start(request("/api/oauth/slack/bot/start"));
    const url = new URL(res.headers.get("location") ?? "");
    expect(url.pathname).toBe("/oauth/v2/authorize");
    expect(url.searchParams.get("state")).toBe("bot.state-1");
    expect(url.searchParams.has("user_scope")).toBe(false);
    expect(setConnectStateCookie).toHaveBeenCalledWith("bot.");
  });

  it("refuses everyone but admins, and when Slack isn't configured", async () => {
    requireAdmin.mockResolvedValueOnce({ user: null, forbidden: false });
    expect((await start(request("/api/oauth/slack/bot/start"))).status).toBe(403);
    requireAdmin.mockResolvedValueOnce({ user: { id: "m1" }, forbidden: true });
    expect((await start(request("/api/oauth/slack/bot/start"))).status).toBe(403);
    vi.stubEnv("SLACK_CLIENT_SECRET", "");
    expect((await start(request("/api/oauth/slack/bot/start"))).status).toBe(503);
    expect(setConnectStateCookie).not.toHaveBeenCalled();
  });
});

describe("GET /api/oauth/slack/callback for a bot install", () => {
  it("stores the token and says so", async () => {
    const res = await callback(request(ok));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Billie Bot is installed");
    expect(completeBotInstall).toHaveBeenCalledWith({}, "code-1");
  });

  it.each([
    ["not an admin", () => requireAdmin.mockResolvedValueOnce({ user: { id: "m1" }, forbidden: true }), ok, 403],
    ["an unknown state", () => consumeConnectStateCookie.mockResolvedValueOnce(false), ok, 400],
    ["a declined approval", () => {}, "/api/oauth/slack/callback?error=access_denied&state=bot.state-1", 400],
    ["no code", () => {}, "/api/oauth/slack/callback?state=bot.state-1", 400],
  ])("stores nothing for %s", async (_label, arrange, path, status) => {
    arrange();
    const res = await callback(request(path));
    expect(res.status).toBe(status);
    expect(completeBotInstall).not.toHaveBeenCalled();
  });

  it("explains why an install was refused", async () => {
    completeBotInstall.mockResolvedValueOnce({ ok: false, reason: "wrong_workspace" });
    const res = await callback(request(ok));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("different Slack workspace");
  });

  it("answers 503 when Slack isn't configured", async () => {
    vi.stubEnv("SLACK_CLIENT_SECRET", "");
    expect((await callback(request(ok))).status).toBe(503);
  });
});
