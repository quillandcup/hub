/**
 * The connect-Slack gate's trip through Slack (lib/gates.ts): `/api/oauth/slack/start?next=` remembers where the visitor was
 * headed, the callback sends them there once the connection works, and forgets it on any other outcome.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const jar = vi.hoisted(() => ({ values: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.values.has(name) ? { value: jar.values.get(name) } : undefined),
    set: (name: string, value: string) => void jar.values.set(name, value),
    delete: (name: string | { name: string }) => void jar.values.delete(typeof name === "string" ? name : name.name),
  }),
}));

const m = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getEffectiveIdentity: vi.fn(),
  configured: vi.fn(),
  stateOk: vi.fn(),
  exchange: vi.fn(),
  link: vi.fn(),
  save: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: m.getCurrentUser }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: m.getEffectiveIdentity }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));
vi.mock("@/lib/supabase/api-auth", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/slack-bot-install", () => ({ BOT_STATE_PREFIX: "bot-", completeBotInstall: vi.fn() }));
vi.mock("@/lib/slack-connect", () => ({
  isSlackConnectConfigured: () => m.configured(),
  setConnectStateCookie: async () => "state-123",
  buildSlackAuthorizeUrl: (state: string) => `https://slack.example.test/authorize?state=${state}`,
  consumeConnectStateCookie: async () => m.stateOk(),
  exchangeSlackCode: (...a: unknown[]) => m.exchange(...a),
  linkSlackAccount: (...a: unknown[]) => m.link(...a),
  saveSlackConnection: (...a: unknown[]) => m.save(...a),
}));

import { GET as start } from "@/app/api/oauth/slack/start/route";
import { GET as callback } from "@/app/api/oauth/slack/callback/route";
import { NEXT_PATH_COOKIE } from "@/lib/safe-next";

const DESTINATION = "/chat/chn_AAAAAAAAAAA1?thread=msg_AAAAAAAAAAA1";
const ORIGIN = "http://localhost:3000";

const startAt = (query = "") => start(new NextRequest(`${ORIGIN}/api/oauth/slack/start${query}`));
const callbackAt = (query: string) => callback(new NextRequest(`${ORIGIN}/api/oauth/slack/callback?${query}`));
const location = (res: Response) => new URL(res.headers.get("location") as string);

beforeEach(() => {
  jar.values.clear();
  m.getCurrentUser.mockResolvedValue({ id: "auth-1", email: "fern@example.test" });
  m.getEffectiveIdentity.mockResolvedValue({ memberId: "mbr_AAAAAAAAAAA1", isSudo: false });
  m.configured.mockReturnValue(true);
  m.stateOk.mockResolvedValue(true);
  m.exchange.mockReset().mockResolvedValue({ slackUserId: "U1" });
  m.link.mockReset().mockResolvedValue({ ok: true });
  m.save.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/oauth/slack/start", () => {
  it("remembers the page the visitor was headed to while they are at Slack", async () => {
    const res = await startAt(`?next=${encodeURIComponent(DESTINATION)}`);

    expect(location(res).origin).toBe("https://slack.example.test");
    expect(jar.values.get(NEXT_PATH_COOKIE)).toBe(DESTINATION);
  });

  it("remembers nothing for a missing or unsafe destination, and still goes to Slack", async () => {
    for (const query of ["", "?next=https%3A%2F%2Fevil.example.com%2F", "?next=%2F%2Fevil.example.com", "?next=%2Flogin"]) {
      jar.values.clear();
      const res = await startAt(query);
      expect(location(res).origin).toBe("https://slack.example.test");
      expect(jar.values.has(NEXT_PATH_COOKIE)).toBe(false);
    }
  });

  it("stores nothing when it won't go to Slack at all (not signed in, in sudo)", async () => {
    m.getCurrentUser.mockResolvedValue(null);
    expect(location(await startAt(`?next=${encodeURIComponent(DESTINATION)}`)).pathname).toBe("/login");
    m.getCurrentUser.mockResolvedValue({ id: "auth-1" });
    m.getEffectiveIdentity.mockResolvedValue({ memberId: "mbr_AAAAAAAAAAA1", isSudo: true });
    expect(location(await startAt(`?next=${encodeURIComponent(DESTINATION)}`)).search).toBe("?slack=sudo");
    expect(jar.values.has(NEXT_PATH_COOKIE)).toBe(false);
  });
});

describe("GET /api/oauth/slack/callback", () => {
  it("sends the visitor on to the page they were headed to once Slack is connected, and uses the memory up", async () => {
    jar.values.set(NEXT_PATH_COOKIE, DESTINATION);

    const res = await callbackAt("code=abc&state=state-123");

    expect(`${location(res).pathname}${location(res).search}`).toBe(DESTINATION);
    expect(m.save).toHaveBeenCalled();
    expect(jar.values.has(NEXT_PATH_COOKIE)).toBe(false);
  });

  it("ends at Settings saying it worked when no gate sent them (an ordinary connect from Settings)", async () => {
    const res = await callbackAt("code=abc&state=state-123");

    expect(`${location(res).pathname}${location(res).search}`).toBe("/settings?slack=connected");
  });

  it("never follows a remembered address that isn't a safe same-origin path", async () => {
    jar.values.set(NEXT_PATH_COOKIE, "https://evil.example.com/");

    const res = await callbackAt("code=abc&state=state-123");

    expect(`${location(res).pathname}${location(res).search}`).toBe("/settings?slack=connected");
  });

  it.each([
    ["Slack didn't approve it", "error=access_denied&state=state-123", "declined"],
    ["there was no code", "state=state-123", "declined"],
  ])("goes back to Settings and forgets the destination when %s", async (_name, query, reason) => {
    jar.values.set(NEXT_PATH_COOKIE, DESTINATION);

    const res = await callbackAt(query);

    expect(location(res).pathname).toBe("/settings");
    expect(location(res).searchParams.get("slack")).toBe(reason);
    expect(jar.values.has(NEXT_PATH_COOKIE)).toBe(false);
    expect(m.save).not.toHaveBeenCalled();
  });

  it("forgets the destination when the flow didn't start in this browser, when Slack's account can't be linked, and when saving fails", async () => {
    jar.values.set(NEXT_PATH_COOKIE, DESTINATION);
    m.stateOk.mockResolvedValue(false);
    expect(location(await callbackAt("code=abc&state=other")).searchParams.get("slack")).toBe("invalid_state");
    expect(jar.values.has(NEXT_PATH_COOKIE)).toBe(false);

    jar.values.set(NEXT_PATH_COOKIE, DESTINATION);
    m.stateOk.mockResolvedValue(true);
    m.link.mockResolvedValue({ ok: false, reason: "wrong_workspace" });
    expect(location(await callbackAt("code=abc&state=state-123")).searchParams.get("slack")).toBe("wrong_workspace");
    expect(jar.values.has(NEXT_PATH_COOKIE)).toBe(false);

    jar.values.set(NEXT_PATH_COOKIE, DESTINATION);
    m.link.mockResolvedValue({ ok: true });
    m.save.mockRejectedValue(new Error("vault down"));
    expect(location(await callbackAt("code=abc&state=state-123")).searchParams.get("slack")).toBe("failed");
    expect(jar.values.has(NEXT_PATH_COOKIE)).toBe(false);
  });
});
