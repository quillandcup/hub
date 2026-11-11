import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeClock } from "../helpers/fake-clock";

const m = vi.hoisted(() => ({
  hasFeature: vi.fn(),
  rpc: vi.fn(),
  record: vi.fn(),
  afterCallbacks: [] as (() => Promise<void> | void)[],
  repos: null as unknown,
}));

vi.mock("next/server", () => ({ after: (cb: () => Promise<void> | void) => void m.afterCallbacks.push(cb) }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => ({ id: "auth-1", email: "fern@example.test" }) }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: async () => ({ memberId: "member-fern", isSudo: false }) }));
vi.mock("@/lib/features.server", () => ({
  getUserFeaturePreviews: vi.fn(async () => []),
  effectiveMemberHasFeature: (key: string) => m.hasFeature(key),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: m.rpc }) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));
vi.mock("@/lib/data/repos", async () => ({ ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")), createRepos: () => m.repos }));
vi.mock("@/lib/analytics/server", () => ({
  withAction: async (name: string, run: () => Promise<unknown>, classify?: (result: unknown) => unknown) => {
    const result = await run();
    if (classify) m.record(name, classify(result));
    return result;
  },
}));
vi.mock("@/lib/slack-connect", () => ({ getSlackConnectionStatus: async () => ({ connected: true }) }));
vi.mock("@/lib/chat/slack-post", () => ({ sendChatMessageToSlack: vi.fn(async () => "sent") }));
vi.mock("@/lib/chat/slack-edit", () => ({ updateChatMessageInSlack: async () => ({ ok: true }), deleteChatMessageInSlack: vi.fn(), deleteChatFileInSlack: vi.fn() }));
vi.mock("@/lib/chat/load", () => ({}));
vi.mock("@/lib/chat/notifications", () => ({ notifyChatMessage: vi.fn(), resolveChatNotifications: vi.fn() }));

import { editChatMessage, hideChatUnfurl, sendChatMessage } from "@/app/(member)/chat/actions";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos, type Repos } from "@/lib/data/repos";
import { resetClock, setClock } from "@/lib/clock";
import { setNetHooks, type Transport } from "@/lib/net/safe-fetch";

const CHANNEL = "chn_AAAAAAAAAAC1";
const MESSAGE = "msg_AAAAAAAAAAD1";
const flushAfter = async () => {
  while (m.afterCallbacks.length) await m.afterCallbacks.shift()!();
};

let requested: string[] = [];
const transport: Transport = async (req) => {
  requested.push(req.url.href);
  const html = req.url.pathname.endsWith(".jpg") ? null : `<html><head><meta property="og:title" content="Page ${req.url.pathname}"></head></html>`;
  return {
    status: 200,
    headers: { "content-type": html ? "text/html" : "image/jpeg" },
    body: (async function* () {
      yield Buffer.from(html ?? "");
    })(),
    destroy: () => {},
  };
};

const repos = () => m.repos as Repos;

beforeEach(() => {
  setClock(new FakeClock(Date.now()));
  requested = [];
  m.afterCallbacks.length = 0;
  m.hasFeature.mockReset().mockResolvedValue(true);
  m.record.mockReset();
  m.rpc.mockReset().mockResolvedValue({ data: MESSAGE, error: null });
  m.repos = createInMemoryRepos(new InMemoryDataset({ chatChannels: [{ id: CHANNEL, slack_channel_id: "C1", bridge_mode: "app_only" } as never], chatMessages: [{ id: MESSAGE, channel_id: CHANNEL, deleted_at: null }] }));
  setNetHooks({ resolve: async () => [{ address: "93.184.216.34" }], transport });
});
afterEach(() => {
  setNetHooks();
  resetClock();
});

describe("link previews after a message is sent", () => {
  it("fetches the links after the response, stores the previews and records the outcome without the address", async () => {
    await expect(sendChatMessage(CHANNEL, "look https://example.test/post and https://example.test/cover.jpg")).resolves.toEqual({ ok: true, id: MESSAGE });
    // Nothing has been fetched while the member waits.
    expect(requested).toEqual([]);

    await flushAfter();

    expect(requested.sort()).toEqual(["https://example.test/cover.jpg", "https://example.test/post"]);
    const previews = (await repos().chatLinkPreviews.forMessages([MESSAGE])).get(MESSAGE)!;
    expect(previews.map((p) => [p.kind, p.title])).toEqual([["link", "Page /post"], ["image", null]]);
    expect(m.record).toHaveBeenCalledWith("chat_link_previews_built", { ok: true, detail: "image" });
  });

  it("fetches nothing for a sender the feature is not on for, and nothing for a message without links", async () => {
    m.hasFeature.mockResolvedValue(false);
    await sendChatMessage(CHANNEL, "look https://example.test/post");
    await flushAfter();
    expect(requested).toEqual([]);

    m.hasFeature.mockResolvedValue(true);
    await sendChatMessage(CHANNEL, "no links here");
    await flushAfter();
    expect(requested).toEqual([]);
    expect(m.record).not.toHaveBeenCalled();
  });

  it("records a failed outcome when no page could be previewed", async () => {
    setNetHooks({ resolve: async () => [{ address: "10.0.0.1" }], transport });
    await sendChatMessage(CHANNEL, "look https://intranet.example.test/");
    await flushAfter();
    expect(m.record).toHaveBeenCalledWith("chat_link_previews_built", { ok: false, detail: "blocked" });
  });

  it("on an edit fetches only the link that was added", async () => {
    await sendChatMessage(CHANNEL, "https://example.test/one");
    await flushAfter();
    requested = [];

    await expect(editChatMessage(MESSAGE, "https://example.test/one https://example.test/two")).resolves.toEqual({ ok: true });
    await flushAfter();

    expect(requested).toEqual(["https://example.test/two"]);
    expect((await repos().chatLinkPreviews.forMessages([MESSAGE])).get(MESSAGE)!.map((p) => p.title)).toEqual(["Page /one", "Page /two"]);
  });

  it("does not let a failure while previewing reach the sender", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    m.hasFeature.mockRejectedValue(new Error("flags down"));
    await sendChatMessage(CHANNEL, "https://example.test/post");
    await expect(flushAfter()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("hideChatUnfurl", () => {
  it("records the removal as the author's own write", async () => {
    await expect(hideChatUnfurl(MESSAGE, "url:https://example.test/post")).resolves.toEqual({ ok: true });
    await expect(hideChatUnfurl(MESSAGE, "idx:2")).resolves.toEqual({ ok: true });
    expect([...((await repos().chatLinkPreviews.hiddenKeys([MESSAGE])).get(MESSAGE) ?? [])].sort()).toEqual(["idx:2", "url:https://example.test/post"]);
  });

  it("refuses a message id or a key that is not one of ours", async () => {
    for (const [id, key] of [["nope", "idx:1"], [MESSAGE, "javascript:alert(1)"], [MESSAGE, "url:http"], [MESSAGE, "idx:123"], [MESSAGE, `url:https://a.test/${"x".repeat(2200)}`]] as const) {
      await expect(hideChatUnfurl(id, key)).resolves.toEqual({ ok: false, error: "Something went wrong." });
    }
    expect((await repos().chatLinkPreviews.hiddenKeys([MESSAGE])).size).toBe(0);
  });

  it("says so when the database refuses (not the author), without putting the address in the log", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    repos().chatLinkPreviews.hide = async () => {
      throw new Error("new row violates row-level security policy");
    };
    await expect(hideChatUnfurl(MESSAGE, "url:https://secret.example.test/?token=abc")).resolves.toEqual({ ok: false, error: "That preview can't be removed." });
    expect(JSON.stringify(error.mock.calls)).not.toContain("secret.example.test");
    error.mockRestore();
  });
});
