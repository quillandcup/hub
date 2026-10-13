import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getEffectiveIdentity: vi.fn(),
  hasFeature: vi.fn(),
  rpc: vi.fn(),
  sendToSlack: vi.fn(),
  syncReaction: vi.fn(),
  slackUpdate: vi.fn(),
  slackDelete: vi.fn(),
  afterCallbacks: [] as (() => Promise<void> | void)[],
  slackReactionRows: [] as { id: string }[],
  connected: vi.fn(),
}));

vi.mock("next/server", () => ({ after: (cb: () => Promise<void> | void) => void m.afterCallbacks.push(cb) }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: m.getCurrentUser }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: m.getEffectiveIdentity }));
vi.mock("@/lib/features.server", () => ({
  getUserFeaturePreviews: vi.fn(async () => []),
  effectiveMemberHasFeature: (key: string) => m.hasFeature(key),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: m.rpc,
    from: () => {
      const chain: Record<string, unknown> = {};
      for (const k of ["select", "eq", "not", "is"]) chain[k] = () => chain;
      chain.limit = async () => ({ data: m.slackReactionRows });
      return chain;
    },
  }),
}));
vi.mock("@/lib/slack-connect", () => ({ getSlackConnectionStatus: (...a: unknown[]) => m.connected(...a) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({ service: true }) }));
vi.mock("@/lib/chat/slack-post", () => ({ sendChatMessageToSlack: m.sendToSlack }));
vi.mock("@/lib/chat/slack-react", () => ({ syncReactionToSlack: m.syncReaction }));
vi.mock("@/lib/chat/slack-edit", () => ({ updateChatMessageInSlack: m.slackUpdate, deleteChatMessageInSlack: m.slackDelete }));
vi.mock("@/lib/chat/load", () => ({}));

import { deleteChatMessage, editChatMessage, sendChatMessage, toggleChatReaction } from "@/app/(member)/chat/actions";

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
  m.slackUpdate.mockReset();
  m.slackUpdate.mockResolvedValue({ ok: true });
  m.slackDelete.mockReset();
  m.slackDelete.mockResolvedValue({ ok: true });
  m.slackReactionRows = [];
  m.connected.mockReset();
  m.connected.mockResolvedValue({ connected: true });
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

  it("won't hide a reaction made in Slack from a member who hasn't connected Slack, and says what to do", async () => {
    m.slackReactionRows = [{ id: "r1" }];
    m.connected.mockResolvedValue({ connected: false });

    await expect(toggleChatReaction(MESSAGE, "tada")).resolves.toEqual({
      ok: false,
      error: "You reacted in Slack. Connect Slack in Settings to take it back from here.",
    });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("takes back a reaction made in Slack for a member who has connected Slack, and removes it in Slack", async () => {
    m.slackReactionRows = [{ id: "r1" }];
    m.rpc.mockResolvedValue({ data: false, error: null });

    await expect(toggleChatReaction(MESSAGE, "tada")).resolves.toEqual({ ok: true, active: false });
    await flushAfter();
    expect(m.syncReaction).toHaveBeenCalledWith({ service: true }, expect.objectContaining({ emoji: "tada", active: false }));
  });
});

describe("editChatMessage", () => {
  it("changes the message in Slack first and then in the Hub, with the trimmed text", async () => {
    m.rpc.mockResolvedValue({ data: null, error: null });

    await expect(editChatMessage(MESSAGE, "  fixed it \n")).resolves.toEqual({ ok: true });

    expect(m.slackUpdate).toHaveBeenCalledWith({ service: true }, { messageId: MESSAGE, memberId: "member-fern", body: "fixed it" });
    expect(m.rpc).toHaveBeenCalledWith("chat_edit_message", { p_message_id: MESSAGE, p_body: "fixed it" });
    expect(m.slackUpdate.mock.invocationCallOrder[0]).toBeLessThan(m.rpc.mock.invocationCallOrder[0]);
  });

  it("leaves the Hub alone when Slack refuses, and says why", async () => {
    m.slackUpdate.mockResolvedValue({ ok: false, error: "Reconnect Slack in Settings to edit this message: it was posted as you." });
    await expect(editChatMessage(MESSAGE, "new")).resolves.toEqual({ ok: false, error: expect.stringContaining("Reconnect Slack") });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("refuses an empty or over-long edit before bothering Slack", async () => {
    await expect(editChatMessage(MESSAGE, " \n ")).resolves.toEqual({ ok: false, error: "Write something first." });
    await expect(editChatMessage(MESSAGE, "x".repeat(4001))).resolves.toMatchObject({ ok: false, error: expect.stringContaining("too long") });
    expect(m.slackUpdate).not.toHaveBeenCalled();
  });

  it("explains what the database refused", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { message: "chat_edit: archived" } });
    await expect(editChatMessage(MESSAGE, "new")).resolves.toEqual({ ok: false, error: "This conversation is archived." });
  });

  it("is closed without the chat_posting preview, in sudo, and for a bad id", async () => {
    await expect(editChatMessage("nope", "new")).resolves.toMatchObject({ ok: false });
    m.hasFeature.mockImplementation(async (key: string) => key !== "chat_posting");
    await expect(editChatMessage(MESSAGE, "new")).resolves.toMatchObject({ ok: false });
    m.hasFeature.mockResolvedValue(true);
    m.getEffectiveIdentity.mockResolvedValue({ memberId: "member-fern", isSudo: true });
    await expect(editChatMessage(MESSAGE, "new")).resolves.toMatchObject({ ok: false });
    expect(m.slackUpdate).not.toHaveBeenCalled();
  });
});

describe("deleteChatMessage", () => {
  it("deletes in Slack first and then in the Hub", async () => {
    m.rpc.mockResolvedValue({ data: null, error: null });

    await expect(deleteChatMessage(MESSAGE)).resolves.toEqual({ ok: true });

    expect(m.slackDelete).toHaveBeenCalledWith({ service: true }, { messageId: MESSAGE, memberId: "member-fern" });
    expect(m.rpc).toHaveBeenCalledWith("chat_delete_message", { p_message_id: MESSAGE });
    expect(m.slackDelete.mock.invocationCallOrder[0]).toBeLessThan(m.rpc.mock.invocationCallOrder[0]);
  });

  it("leaves the message in the Hub when Slack won't delete it", async () => {
    m.slackDelete.mockResolvedValue({ ok: false, error: "Slack won't let this message be deleted." });
    await expect(deleteChatMessage(MESSAGE)).resolves.toEqual({ ok: false, error: "Slack won't let this message be deleted." });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("is closed without the chat_posting preview and for a bad id", async () => {
    await expect(deleteChatMessage("nope")).resolves.toMatchObject({ ok: false });
    m.hasFeature.mockImplementation(async (key: string) => key !== "chat_posting");
    await expect(deleteChatMessage(MESSAGE)).resolves.toMatchObject({ ok: false });
    expect(m.slackDelete).not.toHaveBeenCalled();
  });
});
