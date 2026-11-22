import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatTransport, DeliveryResult } from "@/lib/chat/transport";
import { NO_TRANSPORT, createChatTransportRegistry } from "@/lib/chat/transports";

const m = vi.hoisted(() => ({
  chatSlackWritesEnabled: vi.fn(() => true),
  postChatMessageToSlack: vi.fn(),
  catchUpChannel: vi.fn(),
  slackUserIdsByMember: vi.fn(),
  join: vi.fn(),
  invite: vi.fn(),
  kick: vi.fn(),
  leave: vi.fn(),
  getSlackUserToken: vi.fn(),
  getSlackBotToken: vi.fn(),
  chatUpdate: vi.fn(),
  rpc: vi.fn(),
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

vi.mock("@/modules/chat/slack/post", () => ({ chatSlackWritesEnabled: m.chatSlackWritesEnabled, postChatMessageToSlack: m.postChatMessageToSlack }));
vi.mock("@/modules/chat/slack/react", () => ({ syncReactionToSlack: m.syncReactionToSlack }));
vi.mock("@/modules/chat/slack/read", () => ({ pullReadFromSlack: m.pullReadFromSlack, pushReadToSlack: m.pushReadToSlack, pushUnreadToSlack: m.pushUnreadToSlack }));
vi.mock("@/modules/chat/slack/dms", () => ({ openSlackDm: m.openSlackDm, pullMemberDms: m.pullMemberDms }));
vi.mock("@/modules/chat/slack/gap-fill", () => ({ catchUpChannel: m.catchUpChannel }));
vi.mock("@/modules/chat/slack/unfurl-removal", () => ({ removeSlackUnfurl: m.removeSlackUnfurl }));
vi.mock("@/modules/chat/slack/edit", () => ({
  deleteChatFileInSlack: m.deleteChatFileInSlack,
  deleteChatMessageInSlack: m.deleteChatMessageInSlack,
  updateChatMessageInSlack: m.updateChatMessageInSlack,
}));
vi.mock("@/lib/slack-connect", () => ({ getSlackConnectionStatus: m.getSlackConnectionStatus, getSlackUserToken: m.getSlackUserToken, isDeadTokenError: (e: { data?: { error?: string } } | null) => e?.data?.error === "token_revoked" }));
vi.mock("@/lib/slack-bot-token", () => ({ getSlackBotToken: m.getSlackBotToken }));
vi.mock("@/lib/slack-client", () => ({
  createSlackClient: () => ({ chat: { update: m.chatUpdate }, conversations: { join: m.join, invite: m.invite, kick: m.kick, leave: m.leave, info: vi.fn() } }),
}));
vi.mock("@/modules/chat/slack/upload", () => ({ keepCopies: m.keepCopies }));
vi.mock("@/lib/data/repos", () => ({ createRepos: () => ({ chat: { slackTarget: m.slackTarget, slackUserIdsByMember: m.slackUserIdsByMember } }) }));

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
  const members = { added: [] as string[][], removed: [] as string[] };
  const reactions: { messageId: string; emoji: string; active: boolean }[] = [];
  const status = new Map<string, DeliveryResult>();
  const transport: ChatTransport = {
    ...NO_TRANSPORT,
    id: "fake",
    writesEnabled: () => true,
    isConnected: async (_db, memberId) => memberId !== "member-unlinked",
    send: async (_db, messageId) => {
      const result: DeliveryResult = opts.failDelivery ? "failed" : "sent";
      if (result === "sent") sent.push(messageId);
      status.set(messageId, result);
      return result === "sent" ? { status: "sent", ref: `ref-${messageId}`, via: "bot" } : { status: "failed" };
    },
    externalIdsFor: async (_db, ids) => new Map(ids.filter((id) => id !== "member-unlinked").map((id) => [id, `ext-${id}`])),
    addToConversation: async (_db, o) => {
      members.added.push(o.externalUserIds);
      return { result: { ok: true }, reconnect: false };
    },
    removeFromConversation: async (_db, o) => {
      members.removed.push(o.externalUserId);
      return { result: { ok: true }, reconnect: o.self };
    },
    syncReaction: async (_db, r) => {
      reactions.push({ messageId: r.messageId, emoji: r.emoji, active: r.active });
      return true;
    },
    editMessage: async (_db, args) => (args.body ? { ok: true } : { ok: false, error: "Nothing to change.", code: "empty" }),
    openDirectConversation: async () => ({ ok: true, channelId: "chan-fake" }),
  };
  return { transport, sent, reactions, status, members };
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
    expect(await t.send(db, "msg-1")).toEqual({ status: "skipped" });
    expect(await t.externalIdsFor(db, ["member-1"])).toEqual(new Map());
    expect((await t.addToConversation(db, { actorMemberId: "member-1", channelRef: "c", externalUserIds: [], selfJoin: false })).result.ok).toBe(false);
    expect((await t.removeFromConversation(db, { actorMemberId: "member-1", channelRef: "c", externalUserId: "u", self: false })).result.ok).toBe(false);
    await expect(t.updateAppMessage({ channelRef: "c", ref: "1", message: {} })).rejects.toThrow(/no chat transport/);
    expect(await t.syncReaction(db, { messageId: "msg-1", memberId: "member-1", emoji: "tada", active: true })).toBe(false);
    expect(await t.editMessage(db, { messageId: "msg-1", memberId: "member-1", body: "hi" })).toEqual({ ok: true });
    expect(await t.deleteMessage(db, { messageId: "msg-1", memberId: "member-1" })).toEqual({ ok: true });
    expect(await t.deleteFile(db, { messageId: "msg-1", memberId: "member-1", fileId: "f" })).toEqual({ ok: true });
    expect(await t.removePreview(db, { messageId: "msg-1", memberId: "member-1", key: "url:x" })).toBe("not_needed");
    await expect(t.keepFileCopies(db, { messageId: "msg-1", sent: [], staged: [], bytes: new Map() })).resolves.toBeUndefined();
    expect(await t.pushRead(db, { memberId: "member-1", channelId: "c", through: "t" })).toBe(false);
    expect(await t.pushUnread(db, { memberId: "member-1", channelId: "c", messageId: "m", marker: "t" })).toBe(false);
    await expect(t.catchUp(db, { channelRef: "room-1" })).resolves.toBeUndefined();
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
  it("sends a message and the transport reports it sent, with its own reference", async () => {
    const { transport, sent, status } = fakeTransport();
    const t = createChatTransportRegistry([transport]).transport();
    expect(await t.send(db, "msg-1")).toEqual({ status: "sent", ref: "ref-msg-1", via: "bot" });
    expect(sent).toEqual(["msg-1"]);
    expect(status.get("msg-1")).toBe("sent");
  });

  it("reports a failed delivery, which core can show as 'didn't send' with a retry", async () => {
    const { transport, sent, status } = fakeTransport({ failDelivery: true });
    const t = createChatTransportRegistry([transport]).transport();
    expect(await t.send(db, "msg-2")).toEqual({ status: "failed" });
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

  it("adds and removes people in a conversation through the transport, and says when it had to act for them", async () => {
    const { transport, members } = fakeTransport();
    const t = createChatTransportRegistry([transport]).transport();
    expect([...(await t.externalIdsFor(db, ["member-1", "member-unlinked"])).keys()]).toEqual(["member-1"]);
    expect(await t.addToConversation(db, { actorMemberId: "member-1", channelRef: "room-1", externalUserIds: ["ext-member-2"], selfJoin: false })).toEqual({ result: { ok: true }, reconnect: false });
    expect(await t.removeFromConversation(db, { actorMemberId: "member-1", channelRef: "room-1", externalUserId: "ext-member-1", self: true })).toEqual({ result: { ok: true }, reconnect: true });
    expect(members).toEqual({ added: [["ext-member-2"]], removed: ["ext-member-1"] });
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

  it("sends through the Slack post code and answers its outcome without recording anything", async () => {
    m.postChatMessageToSlack.mockResolvedValue({ status: "sent", ref: "1.2", via: "user_token" });
    expect(await slackTransport.send(db, "msg-1")).toEqual({ status: "sent", ref: "1.2", via: "user_token" });
    expect(m.postChatMessageToSlack).toHaveBeenCalledWith(db, "msg-1");
  });

  it("mirrors reactions through the Slack modules", async () => {
    m.syncReactionToSlack.mockResolvedValue(true);
    expect(await slackTransport.syncReaction(db, { messageId: "msg-1", memberId: "member-1", emoji: "tada", active: true })).toBe(true);
    expect(m.syncReactionToSlack).toHaveBeenCalledWith(db, { messageId: "msg-1", memberId: "member-1", emoji: "tada", active: true });
  });

  it("names members by their Slack ids", async () => {
    m.slackUserIdsByMember.mockResolvedValue(new Map([["member-1", "U1"]]));
    expect(await slackTransport.externalIdsFor(db, ["member-1"])).toEqual(new Map([["member-1", "U1"]]));
  });

  describe("conversation membership", () => {
    beforeEach(() => {
      m.getSlackUserToken.mockResolvedValue({ token: "xoxp-member" });
      m.getSlackBotToken.mockResolvedValue("xoxb-bot");
      m.chatSlackWritesEnabled.mockReturnValue(true);
    });

    it("joins yourself, or invites others, as the member when their own link works", async () => {
      m.join.mockResolvedValue({ ok: true });
      m.invite.mockResolvedValue({ ok: true });
      expect(await slackTransport.addToConversation(db, { actorMemberId: "member-1", channelRef: "C1", externalUserIds: ["U1"], selfJoin: true })).toEqual({ result: { ok: true }, reconnect: false });
      expect(m.join).toHaveBeenCalledWith({ channel: "C1" });
      await slackTransport.addToConversation(db, { actorMemberId: "member-1", channelRef: "C1", externalUserIds: ["U2", "U3"], selfJoin: false });
      expect(m.invite).toHaveBeenCalledWith({ channel: "C1", users: "U2,U3" });
    });

    it("acts as the app when the member has no link, and keeps Slack's own refusal when their link answered", async () => {
      m.getSlackUserToken.mockResolvedValue(null);
      m.invite.mockResolvedValue({ ok: true });
      expect(await slackTransport.addToConversation(db, { actorMemberId: "member-1", channelRef: "C1", externalUserIds: ["U2"], selfJoin: false })).toEqual({ result: { ok: true }, reconnect: false });

      vi.spyOn(console, "error").mockImplementation(() => {});
      m.getSlackUserToken.mockResolvedValue({ token: "xoxp-member" });
      m.kick.mockRejectedValue({ data: { error: "restricted_action" } });
      const out = await slackTransport.removeFromConversation(db, { actorMemberId: "member-1", channelRef: "C1", externalUserId: "U2", self: false });
      expect(out.reconnect).toBe(false);
      expect(out.result.ok).toBe(false);
      expect(m.kick).toHaveBeenCalledTimes(1);
    });

    it("revokes a dead link, acts as the app, and asks the member to reconnect", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      m.leave.mockRejectedValue({ data: { error: "token_revoked" } });
      m.kick.mockRejectedValue({ data: { error: "restricted_action" } });
      const out = await slackTransport.removeFromConversation({ rpc: m.rpc } as never, { actorMemberId: "member-1", channelRef: "C1", externalUserId: "U1", self: true });
      expect(m.rpc).toHaveBeenCalledWith("slack_connection_revoke", { p_member: "member-1" });
      expect(out.reconnect).toBe(true);
      expect(out.result.ok).toBe(false);
      expect(!out.result.ok && out.result.error).toMatch(/Reconnect Slack in Settings to do this as yourself\.$/);
    });
  });

  it("catches a conversation up from Slack when it is opened", async () => {
    m.catchUpChannel.mockResolvedValue({ claimed: true });
    await expect(slackTransport.catchUp(db, { channelRef: "C1" })).resolves.toBeUndefined();
    expect(m.catchUpChannel).toHaveBeenCalledWith(db, { channelId: "C1", source: "open" });
  });

  it("updates a message the app posted, as the app, and refuses without a bot token", async () => {
    m.getSlackBotToken.mockResolvedValueOnce("xoxb-1");
    await slackTransport.updateAppMessage({ channelRef: "D1", ref: "1.2", message: { text: "hi" } });
    expect(m.chatUpdate).toHaveBeenCalledWith({ channel: "D1", ts: "1.2", text: "hi" });
    m.getSlackBotToken.mockResolvedValueOnce(null);
    await expect(slackTransport.updateAppMessage({ channelRef: "D1", ref: "1.2", message: {} })).rejects.toThrow("no Slack bot token");
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
