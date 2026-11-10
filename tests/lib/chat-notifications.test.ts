import { describe, it, expect, vi, beforeEach } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos, type Repos } from "@/lib/data/repos";
import type { ChatChannelMemberSeed, ChatMessageContentSeed, ChatMessageSeed, ChatNotificationContext, NotifiableMember } from "@/lib/data/chat";
import { useFakeClock } from "../helpers/fake-clock";
import { APP_URL } from "@/lib/config";

vi.mock("@/lib/slack", () => ({ sendSlackDM: vi.fn(async () => {}) }));
vi.mock("@/lib/slack-member-ids", () => ({ resolveSlackUserIds: async () => new Map() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/operations-alerts", () => ({ sendOperationsAlert: vi.fn(async () => {}) }));

let dataset: InMemoryDataset;
let repos: Repos;
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));

const {
  CHAT_NOTIFY_MAX_AGE_MS,
  CHAT_UNREAD_CLAIM_KIND,
  chatNotificationMessage,
  chatNotificationRef,
  decideChatNotifications,
  notifyChatMessage,
  notifyChatMessageBySlackTs,
  notifyPulledMessages,
  resolveChatNotifications,
} = await import("@/lib/chat/notifications");

const NOW = Date.UTC(2026, 10, 10, 15, 0, 0);
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

const CH = "chn_AAAAAAAAAAA1";
const DM = "chn_AAAAAAAAAAA2";
const MSG = "msg_AAAAAAAAAAA1";

const context = (over: { message?: Partial<ChatNotificationContext["message"]>; channel?: Partial<ChatNotificationContext["channel"]> } = {}): ChatNotificationContext => ({
  message: { id: MSG, channelId: CH, authorMemberId: "m1", threadRootId: null, systemSubtype: null, deletedAt: null, createdAt: minutesAgo(1), body: "", ...over.message },
  channel: { id: CH, kind: "channel", name: "writing", archivedAt: null, ...over.channel },
});
const member = (memberId: string, over: Partial<NotifiableMember> = {}): NotifiableMember => ({ memberId, setting: "default", readMarker: minutesAgo(60), ...over });
const decide = (over: Partial<Parameters<typeof decideChatNotifications>[0]> & { members: NotifiableMember[] }) =>
  decideChatNotifications({ context: context(), mentionedMemberIds: new Set(), mentionsEveryone: false, now: new Date(NOW), ...over });

describe("decideChatNotifications", () => {
  it("tells a member of a direct message by default, and nobody else in a channel", () => {
    expect(decide({ context: context({ channel: { id: DM, kind: "dm", name: null } }), members: [member("m2")] })).toEqual([
      expect.objectContaining({ memberId: "m2", kind: "chat_dm" }),
    ]);
    expect(decide({ members: [member("m2")] })).toEqual([]);
  });

  it("treats a group message like a direct message", () => {
    expect(decide({ context: context({ channel: { kind: "group_dm", name: null } }), members: [member("m2")] })).toEqual([expect.objectContaining({ kind: "chat_dm" })]);
  });

  it("tells a member who follows every message of a channel, but only for top-level messages", () => {
    const members = [member("m2", { setting: "all" })];
    expect(decide({ members })).toEqual([expect.objectContaining({ memberId: "m2", kind: "chat_channel_message" })]);
    expect(decide({ context: context({ message: { threadRootId: "msg_AAAAAAAAAAA9" } }), members })).toEqual([]);
  });

  it("tells a mentioned member as a mention in a channel and as a direct message in a direct conversation", () => {
    const mentioned = new Set(["m2"]);
    expect(decide({ members: [member("m2"), member("m3")], mentionedMemberIds: mentioned })).toEqual([expect.objectContaining({ memberId: "m2", kind: "chat_mention", why: "mentioned" })]);
    expect(decide({ context: context({ channel: { kind: "dm", name: null } }), members: [member("m2", { setting: "mentions" })], mentionedMemberIds: mentioned })).toEqual([
      expect.objectContaining({ kind: "chat_dm" }),
    ]);
  });

  it("lets @channel and @here mention everyone in a channel, but not in a direct message", () => {
    const members = [member("m2"), member("m3", { setting: "mentions" })];
    expect(decide({ members, mentionsEveryone: true }).map((d) => [d.memberId, d.kind])).toEqual([["m2", "chat_mention"], ["m3", "chat_mention"]]);
    expect(decide({ context: context({ channel: { kind: "dm", name: null } }), members: [member("m2", { setting: "mentions" })], mentionsEveryone: true })).toEqual([]);
  });

  it("does not tell a member in a direct message who only wants mentions, until they are mentioned", () => {
    expect(decide({ context: context({ channel: { kind: "dm", name: null } }), members: [member("m2", { setting: "mentions" })] })).toEqual([]);
  });

  it("never tells the author of the message", () => {
    expect(decide({ context: context({ channel: { kind: "dm", name: null } }), members: [member("m1")] })).toEqual([]);
    expect(decide({ members: [member("m1", { setting: "all" })], mentionedMemberIds: new Set(["m1"]) })).toEqual([]);
  });

  it("never tells a member who muted the conversation, even when mentioned", () => {
    expect(decide({ members: [member("m2", { setting: "nothing" })], mentionedMemberIds: new Set(["m2"]) })).toEqual([]);
    expect(decide({ context: context({ channel: { kind: "dm", name: null } }), members: [member("m2", { setting: "nothing" })] })).toEqual([]);
  });

  it("says nothing for a Slack notice, a deleted message or an archived conversation", () => {
    const members = [member("m2", { setting: "all" })];
    expect(decide({ context: context({ message: { systemSubtype: "channel_join" } }), members })).toEqual([]);
    expect(decide({ context: context({ message: { deletedAt: minutesAgo(0) } }), members })).toEqual([]);
    expect(decide({ context: context({ channel: { archivedAt: minutesAgo(5) } }), members })).toEqual([]);
  });

  it("says nothing for an old message (a catch-up or a re-pull) or one the member has read past", () => {
    const members = [member("m2", { setting: "all" })];
    const old = new Date(NOW - CHAT_NOTIFY_MAX_AGE_MS - 1000).toISOString();
    expect(decide({ context: context({ message: { createdAt: old } }), members })).toEqual([]);
    expect(decide({ members: [member("m2", { setting: "all", readMarker: minutesAgo(0) })] })).toEqual([]);
    expect(decide({ context: context({ message: { createdAt: "not a date" } }), members })).toEqual([]);
  });
});

describe("chatNotificationMessage", () => {
  const input = { authorName: "Ada Example", channelKind: "dm" as const, channelName: null, channelId: CH, threadRootId: null };

  it("links to the exact conversation, and to the thread for a reply, with a ref per conversation", () => {
    const plain = chatNotificationMessage("chat_dm", input);
    expect(plain.url).toBe(`${APP_URL}/chat/${CH}`);
    expect(plain.ref).toBe(chatNotificationRef(CH));
    expect(chatNotificationMessage("chat_mention", { ...input, channelKind: "channel", channelName: "writing", threadRootId: "msg_AAAAAAAAAAA9" }).url).toBe(`${APP_URL}/chat/${CH}?thread=msg_AAAAAAAAAAA9`);
  });

  it("says who and where, and is not time-sensitive", () => {
    expect(chatNotificationMessage("chat_dm", input).text).toBe("Ada Example sent you a direct message.");
    expect(chatNotificationMessage("chat_dm", { ...input, channelKind: "group_dm" }).text).toBe("Ada Example sent a message in your group conversation.");
    expect(chatNotificationMessage("chat_mention", { ...input, channelKind: "channel", channelName: "writing" }).text).toBe("Ada Example mentioned you in #writing.");
    const channel = chatNotificationMessage("chat_channel_message", { ...input, channelKind: "channel", channelName: "writing" });
    expect(channel.text).toBe("New message from Ada Example in #writing.");
    expect(channel.timeSensitiveUntil).toBeUndefined();
  });

  it("escapes a name that holds & or < for Slack, and leaves the other channels' text plain", () => {
    const message = chatNotificationMessage("chat_dm", { ...input, authorName: "Ada & <Bea>" });
    expect(message.text).toContain("Ada & <Bea>");
    expect(JSON.stringify(message.slackBlocks)).toContain("Ada &amp; &lt;Bea&gt;");
    expect(JSON.stringify(message.slackBlocks)).not.toContain("<Bea>");
  });

  it("falls back to the chat list when there is no conversation (the test notification)", () => {
    expect(chatNotificationMessage("chat_dm", { ...input, channelId: null }).url).toBe(`${APP_URL}/chat`);
    expect(chatNotificationMessage("chat_dm", { ...input, channelId: null }).ref).toBeUndefined();
  });
});

// --- the sender ---

const flagOn = { feature_key: "chat_notifications", enabled_globally: true, created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z" };
const optIn = (memberId: string, kind: string) => ({ memberId, kind, channel: "in_app", enabled: true });

function world(over: { flag?: boolean; prefs?: ReturnType<typeof optIn>[]; memberships?: ChatChannelMemberSeed[]; messages?: ChatMessageSeed[]; contents?: ChatMessageContentSeed[] } = {}) {
  dataset = new InMemoryDataset({
    members: ["m1", "m2", "m3", "m4"].map((id) => ({ id, name: `Member ${id}`, firstJoinedAt: "2024-01-01", userId: `u-${id}` })),
    featureFlags: over.flag === false ? [] : [flagOn],
    notificationPreferences: over.prefs ?? [optIn("m2", "chat_dm"), optIn("m2", "chat_mention"), optIn("m2", "chat_channel_message"), optIn("m3", "chat_dm")],
    chatChannels: [
      { id: CH, kind: "channel", name: "writing", visibility: "public", slack_channel_id: "C1" },
      { id: DM, kind: "dm", name: null, visibility: "private", restricted: true, slack_channel_id: "D1" },
    ],
    chatSlackAuthors: [{ slack_user_id: "U2", member_id: "m2" }, { slack_user_id: "U4", member_id: "m4" }],
    chatChannelMembers: over.memberships ?? [
      { channel_id: DM, member_id: "m1", joined_at: minutesAgo(600), last_read_at: minutesAgo(600) },
      { channel_id: DM, member_id: "m2", joined_at: minutesAgo(600), last_read_at: minutesAgo(600) },
      { channel_id: CH, member_id: "m1", joined_at: minutesAgo(600), last_read_at: minutesAgo(600) },
      { channel_id: CH, member_id: "m2", joined_at: minutesAgo(600), last_read_at: minutesAgo(600) },
      { channel_id: CH, member_id: "m3", joined_at: minutesAgo(600), last_read_at: minutesAgo(600), notify_level: "all" },
    ],
    chatMessages: over.messages ?? [
      { id: MSG, channel_id: DM, author_member_id: "m1", created_at: minutesAgo(1), slack_ts: `${(NOW - 60_000) / 1000}` },
    ],
    chatMessageContents: over.contents ?? [{ message_id: MSG, body: "a secret sentence" }],
  });
  repos = createInMemoryRepos(dataset);
  return repos;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => {});
  world();
});

describe("notifyChatMessage", () => {
  useFakeClock(() => NOW);

  it("tells a member of a direct message in the app, once, with a link to the conversation and none of the text", async () => {
    const result = await notifyChatMessage(repos, MSG);

    expect(result.sent).toEqual([{ memberId: "m2", kind: "chat_dm", channels: ["in_app"] }]);
    expect(dataset.inAppNotifications).toEqual([
      expect.objectContaining({ memberId: "m2", kind: "chat_dm", ref: chatNotificationRef(DM), url: `/chat/${DM}`, text: "Member m1 sent you a direct message." }),
    ]);
    expect(JSON.stringify(dataset.inAppNotifications)).not.toContain("secret sentence");
    expect(dataset.notificationLog).toEqual([expect.objectContaining({ recipient: "m2", kind: CHAT_UNREAD_CLAIM_KIND })]);
  });

  it("is one notification for a burst, a webhook retry and a re-pull, then a new one after the conversation is read", async () => {
    await notifyChatMessage(repos, MSG);
    await notifyChatMessage(repos, MSG);
    dataset.chatMessages.push({ id: "msg_AAAAAAAAAAA2", channel_id: DM, author_member_id: "m1", created_at: minutesAgo(0.5) });
    await notifyChatMessage(repos, "msg_AAAAAAAAAAA2");
    expect(dataset.inAppNotifications).toHaveLength(1);

    // Reading moves the marker (the Hub's read path, or Slack's synced into it): the next message is a new stretch.
    dataset.chatChannelMembers.find((m) => m.channel_id === DM && m.member_id === "m2")!.last_read_at = minutesAgo(0.4);
    dataset.chatMessages.push({ id: "msg_AAAAAAAAAAA3", channel_id: DM, author_member_id: "m1", created_at: minutesAgo(0.1) });
    await notifyChatMessage(repos, "msg_AAAAAAAAAAA3");
    expect(dataset.inAppNotifications).toHaveLength(2);
  });

  it("resolves the conversation's notifications when it is read", async () => {
    await notifyChatMessage(repos, MSG);
    expect(await repos.notifications.inAppUnread("m2", 10)).toHaveLength(1);

    await resolveChatNotifications(repos, "m2", DM);

    expect(await repos.notifications.inAppUnread("m2", 10)).toHaveLength(0);
    // Another member's notification for the same conversation is not touched.
    await resolveChatNotifications(repos, "m3", DM);
  });

  it("does nothing for a member who has not turned it on, and claims nothing so turning it on later still tells them", async () => {
    world({ prefs: [] });
    const result = await notifyChatMessage(repos, MSG);
    expect(result).toEqual({ sent: [], dryRun: [] });
    expect(dataset.inAppNotifications).toEqual([]);
    expect(dataset.notificationLog).toEqual([]);
  });

  it("only logs, claiming nothing and sending nothing, for a member the feature is not on for (dry run)", async () => {
    world({ flag: false });
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const result = await notifyChatMessage(repos, MSG);
    expect(result).toEqual({ sent: [], dryRun: [{ memberId: "m2", kind: "chat_dm" }] });
    expect(dataset.inAppNotifications).toEqual([]);
    expect(dataset.notificationLog).toEqual([]);
    const logged = info.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain("m2");
    expect(logged).toContain("chat_dm");
    expect(logged).toContain("in_app");
    expect(logged).not.toContain("secret sentence");
  });

  it("tells only the members in the conversation: one outside it (or who left) hears nothing", async () => {
    world({
      memberships: [
        { channel_id: DM, member_id: "m1", joined_at: minutesAgo(600), last_read_at: minutesAgo(600) },
        { channel_id: DM, member_id: "m2", joined_at: minutesAgo(600), last_read_at: minutesAgo(600), left_at: minutesAgo(30) },
      ],
    });
    expect(await notifyChatMessage(repos, MSG)).toEqual({ sent: [], dryRun: [] });
    // m3 follows another conversation and is not in this one.
    expect(dataset.inAppNotifications).toEqual([]);
  });

  it("does not tell the author, a muted member, or anyone for a notice", async () => {
    dataset.chatChannelMembers.find((m) => m.channel_id === DM && m.member_id === "m2")!.muted = true;
    expect(await notifyChatMessage(repos, MSG)).toEqual({ sent: [], dryRun: [] });

    dataset.chatChannelMembers.find((m) => m.channel_id === DM && m.member_id === "m2")!.muted = false;
    dataset.chatMessages[0].system_subtype = "channel_join";
    expect(await notifyChatMessage(repos, MSG)).toEqual({ sent: [], dryRun: [] });
    expect(dataset.inAppNotifications).toEqual([]);
  });

  it("tells a mentioned member of a channel, and one who follows every message, but not the rest", async () => {
    world({
      messages: [{ id: MSG, channel_id: CH, author_member_id: "m1", created_at: minutesAgo(1) }],
      contents: [{ message_id: MSG, body: "hello <@U2> and everyone" }],
    });
    const result = await notifyChatMessage(repos, MSG);
    expect(result.sent.map((s) => [s.memberId, s.kind]).sort()).toEqual([["m2", "chat_mention"]]);
    // m3 follows every message but has only the direct message kind on, so nothing is reachable and no claim is taken.
    expect(dataset.inAppNotifications.map((n) => n.memberId)).toEqual(["m2"]);
  });

  it("tells a follower of the channel of an ordinary message when they turned that kind on", async () => {
    world({
      prefs: [optIn("m3", "chat_channel_message")],
      messages: [{ id: MSG, channel_id: CH, author_member_id: "m1", created_at: minutesAgo(1) }],
      contents: [{ message_id: MSG, body: "no mentions here" }],
    });
    const result = await notifyChatMessage(repos, MSG);
    expect(result.sent).toEqual([{ memberId: "m3", kind: "chat_channel_message", channels: ["in_app"] }]);
  });

  it("does not load a channel's whole roster for an ordinary message", async () => {
    world({
      messages: [{ id: MSG, channel_id: CH, author_member_id: "m1", created_at: minutesAgo(1) }],
      contents: [{ message_id: MSG, body: "nothing special" }],
    });
    const spy = vi.spyOn(repos.chat, "notifiableMembers");
    await notifyChatMessage(repos, MSG);
    expect(spy).toHaveBeenCalledWith(CH, { everyone: false, memberIds: [] });
  });

  it("finds the message by its Slack channel and ts, and ignores one it does not know", async () => {
    const ts = `${(NOW - 60_000) / 1000}`;
    expect((await notifyChatMessageBySlackTs(repos, "D1", ts)).sent).toHaveLength(1);
    expect(await notifyChatMessageBySlackTs(repos, "D1", "1.1")).toEqual({ sent: [], dryRun: [] });
    expect(await notifyChatMessageBySlackTs(repos, "NOPE", ts)).toEqual({ sent: [], dryRun: [] });
  });

  it("does nothing for an old message without loading any members", async () => {
    world({ messages: [{ id: MSG, channel_id: DM, author_member_id: "m1", created_at: minutesAgo(120) }] });
    const spy = vi.spyOn(repos.chat, "notifiableMembers");
    expect(await notifyChatMessage(repos, MSG)).toEqual({ sent: [], dryRun: [] });
    expect(spy).not.toHaveBeenCalled();
  });

  it("never throws: a failure is logged and nothing is sent", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    repos.chat.notificationContext = async () => {
      throw new Error("db down");
    };
    expect(await notifyChatMessage(repos, MSG)).toEqual({ sent: [], dryRun: [] });
    repos.chat.idBySlackChannel = async () => {
      throw new Error("db down");
    };
    expect(await notifyChatMessageBySlackTs(repos, "D1", "1.1")).toEqual({ sent: [], dryRun: [] });
    expect(error).toHaveBeenCalledTimes(2);
  });

  it("gives the claim back when nothing got through, so the next message tries again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    repos.notifications.addInApp = async () => {
      throw new Error("boom");
    };
    expect(await notifyChatMessage(repos, MSG)).toEqual({ sent: [], dryRun: [] });
    expect(dataset.notificationLog).toEqual([]);
  });

  it("falls back to someone when the author is not a Hub member", async () => {
    dataset.chatMessages[0].author_member_id = null;
    await notifyChatMessage(repos, MSG);
    expect(dataset.inAppNotifications[0].text).toBe("Someone sent you a direct message.");
  });
});

describe("notifyPulledMessages", () => {
  useFakeClock(() => NOW);

  it("considers only the young messages of a pull, newest first, and queries nothing for old history", async () => {
    const lookups = vi.spyOn(repos.chat, "idBySlackChannel");
    await notifyPulledMessages(repos, "D1", [`${(NOW - 3 * 3_600_000) / 1000}`, `${(NOW - 2 * 86_400_000) / 1000}`]);
    expect(lookups).not.toHaveBeenCalled();

    await notifyPulledMessages(repos, "D1", ["1.1", `${(NOW - 60_000) / 1000}`]);
    expect(lookups).toHaveBeenCalledTimes(1);
    expect(dataset.inAppNotifications).toHaveLength(1);
  });
});
