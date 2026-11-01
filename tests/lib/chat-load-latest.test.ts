import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getEffectiveIdentity: vi.fn(),
  hasFeature: vi.fn(),
  loadChannelForMember: vi.fn(),
  loadMessage: vi.fn(),
  loadMessages: vi.fn(),
  loadMessagesByIds: vi.fn(),
  loadChatChannels: vi.fn(),
  buildMessageViews: vi.fn(),
  chatTextContext: vi.fn(),
}));

vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: m.getCurrentUser }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: m.getEffectiveIdentity }));
vi.mock("@/lib/features.server", () => ({
  getUserFeaturePreviews: vi.fn(async () => []),
  effectiveMemberHasFeature: (key: string) => m.hasFeature(key),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ supabase: true }) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));
vi.mock("@/lib/chat/slack-post", () => ({ sendChatMessageToSlack: vi.fn() }));
vi.mock("@/lib/chat/slack-react", () => ({ syncReactionToSlack: vi.fn() }));
vi.mock("@/lib/slack-connect", () => ({ getSlackConnectionStatus: vi.fn() }));
// The member's read marker comes from the chat repository, here in memory.
let memberships: { channel_id: string; member_id: string; last_read_at?: string; joined_at?: string }[] = [];
let markerFails = false;
vi.mock("@/lib/data/repos", async () => {
  const actual = await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos");
  const { InMemoryDataset } = await import("@/lib/data/in-memory");
  return {
    ...actual,
    createRepos: () => {
      const repos = actual.createInMemoryRepos(new InMemoryDataset({ chatChannelMembers: memberships }));
      if (markerFails) repos.chat.readMarker = async () => { throw new Error("db down"); };
      return repos;
    },
  };
});
vi.mock("@/lib/chat/load", () => ({
  loadChannelForMember: m.loadChannelForMember,
  loadMessage: m.loadMessage,
  loadMessages: m.loadMessages,
  loadMessagesByIds: m.loadMessagesByIds,
  loadChatChannels: m.loadChatChannels,
  buildMessageViews: m.buildMessageViews,
  chatTextContext: m.chatTextContext,
}));

import { loadLatestChat, loadThreadChat } from "@/app/(member)/chat/actions";

const CHANNEL = "chn_AAAAAAAAAAC1";
const ROOT = "msg_AAAAAAAAAAD1";

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.getCurrentUser.mockResolvedValue({ id: "auth-1", email: "fern@example.test" });
  m.getEffectiveIdentity.mockResolvedValue({ memberId: "member-fern", isSudo: false });
  m.hasFeature.mockResolvedValue(true);
  m.loadChannelForMember.mockResolvedValue({ id: CHANNEL, restricted: false });
  m.loadMessages.mockResolvedValue({ messages: [{ id: "m1" }], olderBefore: "2026-10-01T00:00:00Z" });
  m.loadMessagesByIds.mockResolvedValue([]);
  m.buildMessageViews.mockResolvedValue({ views: [{ id: "m1" }], userNames: { U1: "Gale" }, userMembers: {}, channelNames: {}, customEmoji: {} });
  m.chatTextContext.mockReturnValue({ ctx: true });
});

describe("loadLatestChat", () => {
  it("returns the newest page's messages and names without reading the channel list again", async () => {
    await expect(loadLatestChat(CHANNEL)).resolves.toEqual({
      views: [{ id: "m1" }],
      ctx: { ctx: true },
      olderBefore: "2026-10-01T00:00:00Z",
    });
    expect(m.loadMessages).toHaveBeenCalledWith({ supabase: true }, CHANNEL, {});
    expect(m.loadChatChannels).not.toHaveBeenCalled();
    expect(m.chatTextContext).toHaveBeenCalledWith(expect.objectContaining({ userNames: { U1: "Gale" } }), []);
  });

  it("also returns the messages asked for (their reactions changed), once each, however old", async () => {
    const OLD = "msg_AAAAAAAAAAE1";
    m.loadMessagesByIds.mockResolvedValue([{ id: OLD }, { id: "m1" }]);

    await loadLatestChat(CHANNEL, [OLD, OLD, "not-a-uuid", "m1"]);

    // Only real ids, each once; and the one already in the newest page isn't built twice.
    expect(m.loadMessagesByIds).toHaveBeenCalledWith({ supabase: true }, CHANNEL, [OLD]);
    expect(m.buildMessageViews).toHaveBeenCalledWith({ supabase: true }, expect.anything(), [{ id: "m1" }, { id: OLD }], "member-fern");
  });

  it("asks for no extra messages when none are named", async () => {
    await loadLatestChat(CHANNEL);
    expect(m.loadMessagesByIds).toHaveBeenCalledWith({ supabase: true }, CHANNEL, []);
  });

  it("returns nothing for a bad id, a signed-out visitor, chat turned off or a conversation the member can't open", async () => {
    await expect(loadLatestChat("not-a-uuid")).resolves.toBeNull();

    m.getCurrentUser.mockResolvedValueOnce(null);
    await expect(loadLatestChat(CHANNEL)).resolves.toBeNull();

    m.hasFeature.mockResolvedValueOnce(false);
    await expect(loadLatestChat(CHANNEL)).resolves.toBeNull();

    m.loadChannelForMember.mockResolvedValueOnce(null);
    await expect(loadLatestChat(CHANNEL)).resolves.toBeNull();
    expect(m.loadMessages).not.toHaveBeenCalled();
  });

  it("returns where the member has read up to when asked: their marker, else when they joined, none in sudo or when unreadable", async () => {
    memberships = [{ channel_id: CHANNEL, member_id: "member-fern", last_read_at: "2026-10-02T00:00:00Z", joined_at: "2026-09-01T00:00:00Z" }];
    await expect(loadLatestChat(CHANNEL, [], true)).resolves.toMatchObject({ readMarker: "2026-10-02T00:00:00Z" });

    memberships = [{ channel_id: CHANNEL, member_id: "member-fern", joined_at: "2026-09-01T00:00:00Z" }];
    await expect(loadLatestChat(CHANNEL, [], true)).resolves.toMatchObject({ readMarker: "2026-09-01T00:00:00Z" });
    await expect(loadLatestChat(CHANNEL)).resolves.toMatchObject({ readMarker: undefined });

    markerFails = true;
    await expect(loadLatestChat(CHANNEL, [], true)).resolves.toMatchObject({ readMarker: null });
    markerFails = false;

    m.getEffectiveIdentity.mockResolvedValue({ memberId: "member-fern", isSudo: true });
    await expect(loadLatestChat(CHANNEL, [], true)).resolves.toMatchObject({ readMarker: null });
  });

  it("hides a restricted conversation's messages while viewing as a member, without reading them", async () => {
    m.getEffectiveIdentity.mockResolvedValue({ memberId: "member-fern", isSudo: true });
    m.loadChannelForMember.mockResolvedValue({ id: CHANNEL, restricted: true });
    await expect(loadLatestChat(CHANNEL)).resolves.toBeNull();
    expect(m.loadMessages).not.toHaveBeenCalled();
  });
});

describe("loadThreadChat", () => {
  beforeEach(() => {
    m.loadMessage.mockResolvedValue({ id: ROOT });
    m.loadMessages.mockResolvedValue({ messages: [{ id: "r1" }, { id: "r2" }], olderBefore: null });
    m.buildMessageViews.mockResolvedValue({ views: [{ id: ROOT }, { id: "r1" }, { id: "r2" }], userNames: {}, userMembers: {}, channelNames: {}, customEmoji: {} });
  });

  it("returns the root first and then its replies, built together, without reading the channel list", async () => {
    await expect(loadThreadChat(CHANNEL, ROOT)).resolves.toEqual({ views: [{ id: ROOT }, { id: "r1" }, { id: "r2" }], ctx: { ctx: true } });
    expect(m.loadMessage).toHaveBeenCalledWith({ supabase: true }, CHANNEL, ROOT);
    expect(m.loadMessages).toHaveBeenCalledWith({ supabase: true }, CHANNEL, { threadRootId: ROOT });
    expect(m.buildMessageViews).toHaveBeenCalledWith({ supabase: true }, expect.anything(), [{ id: ROOT }, { id: "r1" }, { id: "r2" }], "member-fern");
    expect(m.loadChatChannels).not.toHaveBeenCalled();
  });

  it("returns nothing for bad ids, no access, a restricted conversation in sudo or a root that is gone", async () => {
    await expect(loadThreadChat("nope", ROOT)).resolves.toBeNull();
    await expect(loadThreadChat(CHANNEL, "nope")).resolves.toBeNull();

    m.loadChannelForMember.mockResolvedValueOnce(null);
    await expect(loadThreadChat(CHANNEL, ROOT)).resolves.toBeNull();

    m.getEffectiveIdentity.mockResolvedValueOnce({ memberId: "member-fern", isSudo: true });
    m.loadChannelForMember.mockResolvedValueOnce({ id: CHANNEL, restricted: true });
    await expect(loadThreadChat(CHANNEL, ROOT)).resolves.toBeNull();
    expect(m.loadMessage).not.toHaveBeenCalled();

    m.loadMessage.mockResolvedValueOnce(null);
    await expect(loadThreadChat(CHANNEL, ROOT)).resolves.toBeNull();
    expect(m.buildMessageViews).not.toHaveBeenCalled();
  });
});
