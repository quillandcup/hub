import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { useFakeClock } from "@/tests/helpers/fake-clock";

const access = vi.fn();
vi.mock("@slack/web-api", () => ({
  WebClient: vi.fn(function () {
    return { oauth: { v2: { access } } };
  }),
}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

import { BOT_STATE_PREFIX, SLACK_BOT_SCOPES, buildBotInstallUrl, completeBotInstall } from "@/lib/slack-bot-install";
import { APP_URL } from "@/lib/config";

const NOW = Date.parse("2026-11-01T12:00:00Z");
const rpc = vi.fn();
const service = { rpc } as never as import("@supabase/supabase-js").SupabaseClient;
const granted = { ok: true, access_token: "xoxe.xoxb-new", refresh_token: "xoxe-1-new", expires_in: 43200, team: { id: "T_TEAM" }, bot_user_id: "U_BOT" };

beforeEach(() => {
  access.mockReset();
  rpc.mockReset();
  rpc.mockResolvedValue({ error: null });
  vi.stubEnv("SLACK_CLIENT_ID", "client-1");
  vi.stubEnv("SLACK_CLIENT_SECRET", "secret-1");
  vi.stubEnv("SLACK_TEAM_ID", "T_TEAM");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the bot scopes", () => {
  it("are exactly the manifest's, so an install asks for what the app is configured with", () => {
    const manifest = parseYaml(fs.readFileSync(path.resolve(__dirname, "../../slack-app-manifest.yml"), "utf8")) as { oauth_config: { scopes: { bot: string[] } } };
    expect([...SLACK_BOT_SCOPES].sort()).toEqual([...manifest.oauth_config.scopes.bot].sort());
  });
});

describe("buildBotInstallUrl", () => {
  it("asks for the bot scopes (not user scopes), returns to the registered callback and carries the state", () => {
    const url = new URL(buildBotInstallUrl(`${BOT_STATE_PREFIX}abc`));
    expect(url.origin + url.pathname).toBe("https://slack.com/oauth/v2/authorize");
    expect(url.searchParams.get("client_id")).toBe("client-1");
    expect(url.searchParams.get("scope")).toBe(SLACK_BOT_SCOPES.join(","));
    expect(url.searchParams.has("user_scope")).toBe(false);
    expect(url.searchParams.get("redirect_uri")).toBe(`${APP_URL}/api/oauth/slack/callback`);
    expect(url.searchParams.get("state")).toBe("bot.abc");
    expect(url.searchParams.get("team")).toBe("T_TEAM");
  });
});

describe("completeBotInstall", () => {
  useFakeClock(() => NOW);

  it("trades the code for the token pair and stores it, replacing what was there", async () => {
    access.mockResolvedValue(granted);
    const result = await completeBotInstall(service, "code-1");
    expect(access).toHaveBeenCalledWith({ client_id: "client-1", client_secret: "secret-1", code: "code-1", redirect_uri: `${APP_URL}/api/oauth/slack/callback` });
    expect(rpc).toHaveBeenCalledWith("slack_bot_token_save", { p_access_token: "xoxe.xoxb-new", p_refresh_token: "xoxe-1-new", p_expires_at: new Date(NOW + 43200_000).toISOString() });
    expect(result).toEqual({ ok: true, botUser: "U_BOT", expiresAt: new Date(NOW + 43200_000) });
  });

  it.each([
    ["a different workspace", { ...granted, team: { id: "T_OTHER" } }, "wrong_workspace"],
    ["no refresh token (rotation isn't on, or it can't be kept alive)", { ...granted, refresh_token: undefined }, "not_rotating"],
    ["no expiry", { ...granted, expires_in: undefined }, "not_rotating"],
    ["no token", { ok: true }, "slack"],
    ["a refusal", { ok: false }, "slack"],
  ])("refuses, storing nothing, for %s", async (_label, answer, reason) => {
    access.mockResolvedValue(answer);
    await expect(completeBotInstall(service, "code-1")).resolves.toEqual({ ok: false, reason });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("says Slack failed when the exchange throws, and store when it can't be stored", async () => {
    access.mockRejectedValueOnce(new Error("invalid_code"));
    await expect(completeBotInstall(service, "code-1")).resolves.toEqual({ ok: false, reason: "slack" });

    access.mockResolvedValue(granted);
    rpc.mockResolvedValue({ error: { message: "db down" } });
    await expect(completeBotInstall(service, "code-1")).resolves.toEqual({ ok: false, reason: "store" });
  });

  it("doesn't check the workspace when none is configured", async () => {
    vi.stubEnv("SLACK_TEAM_ID", "");
    access.mockResolvedValue({ ...granted, team: { id: "T_ANY" } });
    await expect(completeBotInstall(service, "code-1")).resolves.toMatchObject({ ok: true });
  });
});
