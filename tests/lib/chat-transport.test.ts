import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatInboundSink, ChatTransport, DeliveryResult } from "@/lib/chat/transport";
import { NO_TRANSPORT, createChatTransportRegistry } from "@/lib/chat/transports";

const m = vi.hoisted(() => ({
  chatSlackWritesEnabled: vi.fn(() => true),
  retryUnsentChatMessages: vi.fn(),
  sendChatMessageToSlack: vi.fn(),
  syncReactionToSlack: vi.fn(),
  pullReadFromSlack: vi.fn(),
  pushReadToSlack: vi.fn(),
  pushUnreadToSlack: vi.fn(),
  openSlackDm: vi.fn(),
  pullMemberDms: vi.fn(),
  removeSlackUnfurl: vi.fn(),
  deleteChatFileInSlack: vi.fn(),
  deleteChatMessageInSlack: vi.fn(),
  updateChatMessageInSlack: vi.fn(),
  getSlackConnectionStatus: vi.fn(),
  keepCopies: vi.fn(),
  slackTarget: vi.fn(),
}));

vi.mock("@/lib/chat/slack-post", () => ({ chatSlackWritesEnabled: m.chatSlackWritesEnabled, retryUnsentChatMessages: m.retryUnsentChatMessages, sendChatMessageToSlack: m.sendChatMessageToSlack }));
vi.mock("@/lib/chat/slack-react", () => ({ syncReactionToSlack: m.syncReactionToSlack }));
vi.mock("@/lib/chat/slack-read", () => ({ pullReadFromSlack: m.pullReadFromSlack, pushReadToSlack: m.pushReadToSlack, pushUnreadToSlack: m.pushUnreadToSlack }));
vi.mock("@/lib/chat/slack-dms", () => ({ openSlackDm: m.openSlackDm, pullMemberDms: m.pullMemberDms }));
vi.mock("@/lib/chat/slack-unfurl-removal", () => ({ removeSlackUnfurl: m.removeSlackUnfurl }));
vi.mock("@/lib/chat/slack-edit", () => ({
  deleteChatFileInSlack: m.deleteChatFileInSlack,
  deleteChatMessageInSlack: m.deleteChatMessageInSlack,
  updateChatMessageInSlack: m.updateChatMessageInSlack,
}));
vi.mock("@/lib/slack-connect", () => ({ getSlackConnectionStatus: m.getSlackConnectionStatus }));
vi.mock("@/lib/chat/slack-upload", () => ({ keepCopies: m.keepCopies }));
vi.mock("@/lib/data/repos", () => ({ createRepos: () => ({ chat: { slackTarget: m.slackTarget } }) }));

import { slackTransport } from "@/modules/chat/slack";
import { installedChatTransports } from "@/modules/chat-transport";

const db = {} as SupabaseClient;

/** Every method the port has; a transport that lacks one fails here before it fails at a call site. */
const PORT_METHODS = Object.keys(NO_TRANSPORT).filter((k) => k !== "id");

/**
 * An in-memory transport with no Slack in it: keeps what core asked of it, so the tests can say what core did. It is also the
 * proof that the port is all core needs.
 */
function fakeTransport(opts: { failDelivery?: boolean } = {}) {
  const sent: string[] = [];
  const reactions: { messageId: string; emoji: string; active: boolean }[] = [];
  const status = new Map<string, DeliveryResult>();
  const transport: ChatTransport = {
    ...NO_TRANSPORT,
    id: "fake",
    writesEnabled: () => true,
    isConnected: async (_db, memberId) => memberId !== "member-unlinked",
    deliver: async (_db, messageId) => {
      const result: DeliveryResult = opts.failDelivery ? "failed" : "sent";
      if (result === "sent") sent.push(messageId);
      status.set(messageId, result);
      return result;
    },
    syncReaction: async (_db, r) => {
      reactions.push({ messageId: r.messageId, emoji: r.emoji, active: r.active });
      return true;
    },
    editMessage: async (_db, args) => (args.body ? { ok: true } : { ok: false, error: "Nothing to change.", code: "empty" }),
    openDirectConversation: async () => ({ ok: true, channelId: "chan-fake" }),
  };
  return { transport, sent, reactions, status };
}

describe("the transport registry", () => {
  it("hands core the installed transport", () => {
    const { transport } = fakeTransport();
    expect(createChatTransportRegistry([transport]).transport()).toBe(transport);
  });

  it("works with no transport installed: every call is a no-op and nothing throws", async () => {
    const t = createChatTransportRegistry([]).transport();
    expect(t).toBe(NO_TRANSPORT);
    expect(t.writesEnabled()).toBe(false);
    expect(await t.isConnected(db, "member-1")).toBe(false);
    expect(await t.deliver(db, "msg-1")).toBe("skipped");
    expect(await t.retryUnsent(db)).toEqual({ sent: 0, failed: 0, expired: 0 });
    expect(await t.syncReaction(db, { messageId: "msg-1", memberId: "member-1", emoji: "tada", active: true })).toBe(false);
    expect(await t.editMessage(db, { messageId: "msg-1", memberId: "member-1", body: "hi" })).toEqual({ ok: true });
    expect(await t.deleteMessage(db, { messageId: "msg-1", memberId: "member-1" })).toEqual({ ok: true });
    expect(await t.deleteFile(db, { messageId: "msg-1", memberId: "member-1", fileId: "f" })).toEqual({ ok: true });
    expect(await t.removePreview(db, { messageId: "msg-1", memberId: "member-1", key: "url:x" })).toBe("not_needed");
    await expect(t.keepFileCopies(db, { messageId: "msg-1", sent: [], staged: [], bytes: new Map() })).resolves.toBeUndefined();
    expect(await t.pushRead(db, { memberId: "member-1", channelId: "c", through: "t" })).toBe(false);
    expect(await t.pushUnread(db, { memberId: "member-1", channelId: "c", messageId: "m", marker: "t" })).toBe(false);
    expect(await t.pullRead(db, "member-1")).toBe(false);
    expect(await t.pullDirectConversations(db, "member-1")).toBeNull();
    expect(await t.openDirectConversation(db, "member-1", "member-2")).toEqual({ ok: false, reason: "not_connected" });
  });

  it("refuses two transports with one name", () => {
    const { transport } = fakeTransport();
    expect(() => createChatTransportRegistry([transport, { ...transport }])).toThrow(/both named "fake"/);
  });
});

describe("chat core against a fake transport (no Slack registered)", () => {
  it("delivers a message and the transport reports it sent", async () => {
    const { transport, sent, status } = fakeTransport();
    const t = createChatTransportRegistry([transport]).transport();
    expect(await t.deliver(db, "msg-1")).toBe("sent");
    expect(sent).toEqual(["msg-1"]);
    expect(status.get("msg-1")).toBe("sent");
  });

  it("reports a failed delivery, which core can show as 'didn't send' with a retry", async () => {
    const { transport, sent, status } = fakeTransport({ failDelivery: true });
    const t = createChatTransportRegistry([transport]).transport();
    expect(await t.deliver(db, "msg-2")).toBe("failed");
    expect(sent).toEqual([]);
    expect(status.get("msg-2")).toBe("failed");
  });

  it("mirrors a reaction on and off", async () => {
    const { transport, reactions } = fakeTransport();
    const t = createChatTransportRegistry([transport]).transport();
    await t.syncReaction(db, { messageId: "msg-1", memberId: "member-1", emoji: "tada", active: true });
    await t.syncReaction(db, { messageId: "msg-1", memberId: "member-1", emoji: "tada", active: false });
    expect(reactions).toEqual([
      { messageId: "msg-1", emoji: "tada", active: true },
      { messageId: "msg-1", emoji: "tada", active: false },
    ]);
  });

  it("tells who is connected, edits, and opens a direct conversation", async () => {
    const { transport } = fakeTransport();
    const t = createChatTransportRegistry([transport]).transport();
    expect(await t.isConnected(db, "member-1")).toBe(true);
    expect(await t.isConnected(db, "member-unlinked")).toBe(false);
    expect(await t.editMessage(db, { messageId: "msg-1", memberId: "member-1", body: "" })).toEqual({ ok: false, error: "Nothing to change.", code: "empty" });
    expect(await t.openDirectConversation(db, "member-1", "member-2")).toEqual({ ok: true, channelId: "chan-fake" });
  });
});

describe("what a transport reports to core", () => {
  it("is four events with the transport's own references, never a Slack shape", async () => {
    const seen: string[] = [];
    const sink: ChatInboundSink = {
      message: async (e) => void seen.push(`message ${e.transport}:${e.ref} in ${e.channelRef}`),
      edit: async (e) => void seen.push(`edit ${e.ref}`),
      delete: async (e) => void seen.push(`delete ${e.ref}`),
      reaction: async (e) => void seen.push(`reaction ${e.emoji} ${e.active ? "on" : "off"} ${e.ref}`),
    };
    const at = "2026-11-21T12:00:00Z";
    await sink.message({ transport: "fake", channelRef: "room-1", ref: "m-1", authorRef: null, body: "hello", threadRef: null, sentAt: at });
    await sink.edit({ transport: "fake", channelRef: "room-1", ref: "m-1", body: "hello there" });
    await sink.reaction({ transport: "fake", channelRef: "room-1", ref: "m-1", authorRef: "u-1", emoji: "tada", active: true });
    await sink.reaction({ transport: "fake", channelRef: "room-1", ref: "m-1", authorRef: "u-1", emoji: "tada", active: false });
    await sink.delete({ transport: "fake", channelRef: "room-1", ref: "m-1" });
    expect(seen).toEqual(["message fake:m-1 in room-1", "edit m-1", "reaction tada on m-1", "reaction tada off m-1", "delete m-1"]);
  });
});

describe("the Slack adapter satisfies the port", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is the installed transport and implements every method of the port", () => {
    expect(installedChatTransports).toEqual([slackTransport]);
    expect(slackTransport.id).toBe("slack");
    for (const method of PORT_METHODS) expect(typeof (slackTransport as unknown as Record<string, unknown>)[method], method).toBe("function");
    expect(Object.keys(slackTransport).sort()).toEqual(Object.keys(NO_TRANSPORT).sort());
  });

  it("delivers, retries and mirrors through the Slack modules", async () => {
    m.sendChatMessageToSlack.mockResolvedValue("sent");
    m.retryUnsentChatMessages.mockResolvedValue({ sent: 1, failed: 0, expired: 0 });
    m.syncReactionToSlack.mockResolvedValue(true);
    expect(await slackTransport.deliver(db, "msg-1")).toBe("sent");
    expect(m.sendChatMessageToSlack).toHaveBeenCalledWith(db, "msg-1");
    expect(await slackTransport.retryUnsent(db)).toEqual({ sent: 1, failed: 0, expired: 0 });
    expect(await slackTransport.syncReaction(db, { messageId: "msg-1", memberId: "member-1", emoji: "tada", active: true })).toBe(true);
    expect(m.syncReactionToSlack).toHaveBeenCalledWith(db, { messageId: "msg-1", memberId: "member-1", emoji: "tada", active: true });
  });

  it("answers isConnected from the member's Slack connection", async () => {
    m.getSlackConnectionStatus.mockResolvedValueOnce({ connected: true }).mockResolvedValueOnce({ connected: false });
    expect(await slackTransport.isConnected(db, "member-1")).toBe(true);
    expect(await slackTransport.isConnected(db, "member-2")).toBe(false);
  });

  it("passes edits, deletes, previews, read state and DM pulls to Slack unchanged", async () => {
    m.updateChatMessageInSlack.mockResolvedValue({ ok: true });
    m.deleteChatMessageInSlack.mockResolvedValue({ ok: true });
    m.deleteChatFileInSlack.mockResolvedValue({ ok: true });
    m.removeSlackUnfurl.mockResolvedValue("updated");
    m.pushReadToSlack.mockResolvedValue(true);
    m.pushUnreadToSlack.mockResolvedValue(true);
    m.pullReadFromSlack.mockResolvedValue(false);
    m.pullMemberDms.mockResolvedValue(null);
    expect(await slackTransport.editMessage(db, { messageId: "msg-1", memberId: "member-1", body: "hi" })).toEqual({ ok: true });
    expect(await slackTransport.deleteMessage(db, { messageId: "msg-1", memberId: "member-1" })).toEqual({ ok: true });
    expect(await slackTransport.deleteFile(db, { messageId: "msg-1", memberId: "member-1", fileId: "f1" })).toEqual({ ok: true });
    expect(await slackTransport.removePreview(db, { messageId: "msg-1", memberId: "member-1", key: "url:x" })).toBe("updated");
    expect(await slackTransport.pushRead(db, { memberId: "member-1", channelId: "c", through: "t" })).toBe(true);
    expect(await slackTransport.pushUnread(db, { memberId: "member-1", channelId: "c", messageId: "m", marker: "t" })).toBe(true);
    expect(await slackTransport.pullRead(db, "member-1", { exceptChannelId: "c" })).toBe(false);
    expect(m.pullReadFromSlack).toHaveBeenCalledWith(db, "member-1", { exceptChannelId: "c" });
    expect(await slackTransport.pullDirectConversations(db, "member-1")).toBeNull();
    expect(m.pullMemberDms).toHaveBeenCalledWith(db, "member-1");
  });

  it("opens a direct conversation and names Slack's refusal in core's terms", async () => {
    m.openSlackDm.mockResolvedValueOnce({ ok: true, channelId: "chan-1" });
    expect(await slackTransport.openDirectConversation(db, "member-1", "member-2")).toEqual({ ok: true, channelId: "chan-1" });
    m.openSlackDm.mockResolvedValueOnce({ ok: false, reason: "slack_refused" });
    expect(await slackTransport.openDirectConversation(db, "member-1", "member-2")).toEqual({ ok: false, reason: "refused" });
    m.openSlackDm.mockResolvedValueOnce({ ok: false, reason: "unknown_person" });
    expect(await slackTransport.openDirectConversation(db, "member-1", "member-2")).toEqual({ ok: false, reason: "unknown_person" });
  });

  it("keeps file copies under the message's Slack channel and ts, and nothing for a message that never reached Slack", async () => {
    const bytes = new Map([["staged/a", Buffer.from("x")]]);
    m.slackTarget.mockResolvedValueOnce({ slackChannelId: "C1", slackTs: "1.2" });
    await slackTransport.keepFileCopies(db, { messageId: "msg-1", sent: [{ id: "F1" }], staged: [{ staged: "staged/a" }], bytes });
    expect(m.keepCopies).toHaveBeenCalledWith(db, [{ id: "F1" }], [{ staged: "staged/a" }], bytes, "C1", "1.2");

    m.keepCopies.mockClear();
    m.slackTarget.mockResolvedValueOnce({ slackChannelId: null, slackTs: null });
    await slackTransport.keepFileCopies(db, { messageId: "msg-2", sent: [], staged: [], bytes });
    m.slackTarget.mockRejectedValueOnce(new Error("db down"));
    await slackTransport.keepFileCopies(db, { messageId: "msg-3", sent: [], staged: [], bytes });
    expect(m.keepCopies).not.toHaveBeenCalled();
  });

  it("reports whether writes are on from the Slack switch", () => {
    m.chatSlackWritesEnabled.mockReturnValueOnce(false);
    expect(slackTransport.writesEnabled()).toBe(false);
  });
});
