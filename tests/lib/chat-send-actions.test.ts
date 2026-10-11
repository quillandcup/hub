import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getEffectiveIdentity: vi.fn(),
  hasFeature: vi.fn(),
  rpc: vi.fn(),
  sendToSlack: vi.fn(),
  syncReaction: vi.fn(),
  afterCallbacks: [] as (() => Promise<void> | void)[],
}));

vi.mock("next/server", () => ({ after: (cb: () => Promise<void> | void) => void m.afterCallbacks.push(cb) }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: m.getCurrentUser }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: m.getEffectiveIdentity }));
vi.mock("@/lib/features.server", () => ({
  getUserFeaturePreviews: vi.fn(async () => []),
  effectiveMemberHasFeature: (key: string) => m.hasFeature(key),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: m.rpc }) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({ service: true }) }));
vi.mock("@/lib/chat/slack-post", () => ({ sendChatMessageToSlack: m.sendToSlack }));
vi.mock("@/lib/chat/slack-react", () => ({ syncReactionToSlack: m.syncReaction }));
vi.mock("@/lib/chat/load", () => ({}));

import { sendChatMessage, toggleChatReaction } from "@/app/(member)/chat/actions";

const CHANNEL = "00000000-0000-4000-a000-0000000000c1";
const MESSAGE = "00000000-0000-4000-a000-0000000000d1";
const flushAfter = async () => {
  while (m.afterCallbacks.length) await m.afterCallbacks.shift()!();
};

beforeEach(() => {
  m.afterCallbacks.length = 0;
  m.getCurrentUser.mockResolvedValue({ id: "auth-1", email: "fern@example.test" });
  m.getEffectiveIdentity.mockResolvedValue({ memberId: "member-fern", isSudo: false });
  m.hasFeature.mockResolvedValue(true);
  m.rpc.mockReset();
  m.sendToSlack.mockReset();
  m.syncReaction.mockReset();
});

describe("sendChatMessage", () => {
  it("returns as soon as the message is saved, and sends it to Slack after the response", async () => {
    m.rpc.mockResolvedValue({ data: MESSAGE, error: null });

    await expect(sendChatMessage(CHANNEL, "hello")).resolves.toEqual({ ok: true, id: MESSAGE });
    expect(m.rpc).toHaveBeenCalledWith("chat_post_message", { p_channel_id: CHANNEL, p_body: "hello", p_thread_root_id: null });
    expect(m.sendToSlack).not.toHaveBeenCalled();

    await flushAfter();
    expect(m.sendToSlack).toHaveBeenCalledWith({ service: true }, MESSAGE);
  });

  it("never lets a failure in the background send surface as an error", async () => {
    m.rpc.mockResolvedValue({ data: MESSAGE, error: null });
    m.sendToSlack.mockRejectedValue(new Error("slack down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(sendChatMessage(CHANNEL, "hello")).resolves.toMatchObject({ ok: true });
    await expect(flushAfter()).resolves.toBeUndefined();
  });

  it("saves nothing and sends nothing when the database refuses, with a message the member can act on", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { message: "chat_post: archived" } });
    await expect(sendChatMessage(CHANNEL, "hello")).resolves.toEqual({ ok: false, error: "This conversation is archived." });
    expect(m.afterCallbacks).toHaveLength(0);
  });

  it("is closed to a member without the chat_posting preview, and to sudo", async () => {
    m.hasFeature.mockImplementation(async (key: string) => key !== "chat_posting");
    await expect(sendChatMessage(CHANNEL, "hello")).resolves.toMatchObject({ ok: false });

    m.hasFeature.mockResolvedValue(true);
    m.getEffectiveIdentity.mockResolvedValue({ memberId: "member-fern", isSudo: true });
    await expect(sendChatMessage(CHANNEL, "hello")).resolves.toMatchObject({ ok: false });
    expect(m.rpc).not.toHaveBeenCalled();
  });
});

describe("toggleChatReaction", () => {
  it("answers as soon as the Hub reaction is saved, and syncs it to Slack after the response", async () => {
    m.rpc.mockResolvedValue({ data: true, error: null });

    await expect(toggleChatReaction(MESSAGE, "tada")).resolves.toEqual({ ok: true, active: true });
    expect(m.syncReaction).not.toHaveBeenCalled();

    await flushAfter();
    expect(m.syncReaction).toHaveBeenCalledWith({ service: true }, { messageId: MESSAGE, memberId: "member-fern", emoji: "tada", active: true });
  });

  it("doesn't sync a reaction the database refused", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { message: "chat_react: no_message" } });
    await expect(toggleChatReaction(MESSAGE, "tada")).resolves.toEqual({ ok: false, error: "That message isn't available." });
    expect(m.afterCallbacks).toHaveLength(0);
  });
});
