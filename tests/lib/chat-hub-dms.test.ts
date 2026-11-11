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
  connected: vi.fn(),
  afterCallbacks: [] as (() => Promise<void> | void)[],
  bridged: false,
  openDm: vi.fn(),
}));

vi.mock("next/server", () => ({ after: (cb: () => Promise<void> | void) => void m.afterCallbacks.push(cb) }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: m.getCurrentUser }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: m.getEffectiveIdentity }));
vi.mock("@/lib/features.server", () => ({
  getUserFeaturePreviews: vi.fn(async () => []),
  effectiveMemberHasFeature: (key: string) => m.hasFeature(key),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: m.rpc }) }));
vi.mock("@/lib/analytics/server", () => ({ withAction: (_name: string, run: () => unknown) => run() }));
// One Hub-only direct message with a message in it, or (m.bridged) the same message in a bridged channel.
vi.mock("@/lib/data/repos", async () => {
  const actual = await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos");
  const { InMemoryDataset } = await import("@/lib/data/in-memory");
  return {
    ...actual,
    createRepos: () =>
      actual.createInMemoryRepos(
        new InMemoryDataset({
          chatChannels: [
            m.bridged
              ? { id: CHANNEL, kind: "channel", visibility: "public", restricted: false, slack_channel_id: "C1" }
              : { id: CHANNEL, kind: "dm", visibility: "private", restricted: true, bridge_mode: "app_only", slack_channel_id: null },
          ],
          chatMessages: [{ id: MESSAGE, channel_id: CHANNEL, origin: "app", author_member_id: "member-fern", slack_sync_status: m.bridged ? "sent" : null }],
        })
      ),
  };
});
vi.mock("@/lib/slack-connect", () => ({ getSlackConnectionStatus: (...a: unknown[]) => m.connected(...a) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({ service: true }) }));
vi.mock("@/lib/chat/slack-post", () => ({ sendChatMessageToSlack: m.sendToSlack }));
vi.mock("@/lib/chat/slack-react", () => ({ syncReactionToSlack: m.syncReaction }));
vi.mock("@/lib/chat/slack-edit", () => ({ updateChatMessageInSlack: m.slackUpdate, deleteChatMessageInSlack: m.slackDelete, deleteChatFileInSlack: vi.fn() }));
vi.mock("@/lib/chat/load", () => ({}));
vi.mock("@/lib/chat/slack-dms", () => ({ openSlackDm: m.openDm, pullMemberDms: vi.fn() }));
vi.mock("@/lib/chat/file-cleanup", () => ({ removeChatFileBytes: vi.fn() }));
const notifyChat = vi.hoisted(() => vi.fn(async () => ({ sent: [], dryRun: [] })));
vi.mock("@/lib/chat/notifications", () => ({ notifyChatMessage: notifyChat, resolveChatNotifications: vi.fn() }));

import { deleteChatMessage, editChatMessage, retryChatMessage, sendChatMessage, toggleChatReaction } from "@/app/(member)/chat/actions";
import { startDirectMessage } from "@/app/(member)/chat/dm-actions";
import { isHubOnlyMessage } from "@/lib/chat/hub-only";
import { createInMemoryRepos } from "@/lib/data/repos";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { membershipAbilities } from "@/lib/chat/membership-abilities";

const CHANNEL = "chn_AAAAAAAAAAC1";
const MESSAGE = "msg_AAAAAAAAAAD1";
const GALE = "mbr_AAAAAAAAAAG1";

beforeEach(() => {
  m.bridged = false;
  m.afterCallbacks.length = 0;
  m.getCurrentUser.mockResolvedValue({ id: "auth-1", email: "fern@example.test" });
  m.getEffectiveIdentity.mockResolvedValue({ memberId: "member-fern", isSudo: false });
  // Everything on except the Slack DM bridge, which has its own tests below.
  m.hasFeature.mockReset().mockImplementation(async (key: string) => key !== "slack_dm_bridge");
  m.openDm.mockReset();
  m.rpc.mockReset();
  for (const fn of [m.sendToSlack, m.syncReaction, m.slackUpdate, m.slackDelete]) fn.mockReset();
  m.slackUpdate.mockResolvedValue({ ok: true });
  m.slackDelete.mockResolvedValue({ ok: true });
  m.connected.mockReset().mockResolvedValue({ connected: false });
});

describe("startDirectMessage", () => {
  it("opens the direct message and returns its channel", async () => {
    m.rpc.mockResolvedValue({ data: CHANNEL, error: null });
    await expect(startDirectMessage(GALE)).resolves.toEqual({ ok: true, channelId: CHANNEL });
    expect(m.rpc).toHaveBeenCalledWith("chat_find_or_create_dm", { p_other_member_id: GALE });
  });

  it("is closed without the direct message preview or in sudo", async () => {
    m.hasFeature.mockImplementation(async (key: string) => key !== "chat_dms" && key !== "slack_dm_bridge");
    await expect(startDirectMessage(GALE)).resolves.toMatchObject({ ok: false, error: expect.stringContaining("available") });
    m.hasFeature.mockImplementation(async (key: string) => key !== "slack_dm_bridge");
    m.getEffectiveIdentity.mockResolvedValue({ memberId: "member-fern", isSudo: true });
    await expect(startDirectMessage(GALE)).resolves.toMatchObject({ ok: false });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("refuses a bad id and a message to yourself", async () => {
    await expect(startDirectMessage("nope")).resolves.toEqual({ ok: false, error: "Something went wrong." });
    m.getEffectiveIdentity.mockResolvedValue({ memberId: GALE, isSudo: false });
    await expect(startDirectMessage(GALE)).resolves.toEqual({ ok: false, error: "You can't message that person." });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("says what the database refused, and hides anything else", async () => {
    m.rpc.mockResolvedValueOnce({ data: null, error: { message: "chat_dm: bad_member" } });
    await expect(startDirectMessage(GALE)).resolves.toEqual({ ok: false, error: "You can't message that person." });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    m.rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    await expect(startDirectMessage(GALE)).resolves.toEqual({ ok: false, error: "Something went wrong. Try again." });
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});

describe("startDirectMessage with the Slack DM bridge on", () => {
  beforeEach(() => m.hasFeature.mockResolvedValue(true));

  it("opens their Slack DM with their own token instead of making a Hub-only one", async () => {
    m.openDm.mockResolvedValue({ ok: true, channelId: CHANNEL });
    await expect(startDirectMessage(GALE)).resolves.toEqual({ ok: true, channelId: CHANNEL });
    expect(m.openDm).toHaveBeenCalledWith({ service: true }, "member-fern", GALE);
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("works without the Hub DM preview, and not at all in sudo", async () => {
    m.openDm.mockResolvedValue({ ok: true, channelId: CHANNEL });
    m.hasFeature.mockImplementation(async (key: string) => key !== "chat_dms");
    await expect(startDirectMessage(GALE)).resolves.toMatchObject({ ok: true });
    m.getEffectiveIdentity.mockResolvedValue({ memberId: "member-fern", isSudo: true });
    await expect(startDirectMessage(GALE)).resolves.toMatchObject({ ok: false });
    expect(m.openDm).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["not_connected", /Reconnect Slack/],
    ["unknown_person", /haven't connected Slack/],
    ["slack_refused", /wouldn't open/],
    ["not_production", /live Hub/],
  ])("says what to do when Slack can't open it (%s)", async (reason, text) => {
    m.openDm.mockResolvedValue({ ok: false, reason });
    await expect(startDirectMessage(GALE)).resolves.toEqual({ ok: false, error: expect.stringMatching(text) });
  });

  it("still refuses yourself and a bad id", async () => {
    m.getEffectiveIdentity.mockResolvedValue({ memberId: GALE, isSudo: false });
    await expect(startDirectMessage(GALE)).resolves.toEqual({ ok: false, error: "You can't message that person." });
    await expect(startDirectMessage("nope")).resolves.toMatchObject({ ok: false });
    expect(m.openDm).not.toHaveBeenCalled();
  });
});

describe("a Hub-only conversation never touches Slack", () => {
  it("posts without a Slack connection and sends nothing to Slack", async () => {
    m.rpc.mockResolvedValue({ data: MESSAGE, error: null });
    await expect(sendChatMessage(CHANNEL, "hello")).resolves.toEqual({ ok: true, id: MESSAGE });
    expect(m.connected).not.toHaveBeenCalled();
    // What is left for after the response is telling the other member (not Slack) and looking at the message's links (none here).
    expect(m.afterCallbacks).toHaveLength(2);
    for (const callback of m.afterCallbacks) await callback();
    expect(notifyChat).toHaveBeenCalledWith(expect.anything(), MESSAGE);
    expect(m.sendToSlack).not.toHaveBeenCalled();
  });

  it("refuses attachments", async () => {
    await expect(sendChatMessage(CHANNEL, "hi", undefined, [{ path: "p", name: "a.txt" } as never])).resolves.toEqual({ ok: false, error: "Files can't be sent in direct messages yet." });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("still needs a Slack connection in a bridged channel", async () => {
    m.bridged = true;
    await expect(sendChatMessage(CHANNEL, "hello")).resolves.toMatchObject({ ok: false, error: expect.stringContaining("Connect Slack") });
  });

  it("reacts without a Slack connection and syncs nothing", async () => {
    m.rpc.mockResolvedValue({ data: true, error: null });
    await expect(toggleChatReaction(MESSAGE, "thumbsup")).resolves.toEqual({ ok: true, active: true });
    expect(m.connected).not.toHaveBeenCalled();
    expect(m.afterCallbacks).toHaveLength(0);
  });

  it("edits and deletes in the Hub only", async () => {
    m.rpc.mockResolvedValue({ data: null, error: null });
    await expect(editChatMessage(MESSAGE, "new")).resolves.toEqual({ ok: true });
    await expect(deleteChatMessage(MESSAGE)).resolves.toEqual({ ok: true });
    expect(m.slackUpdate).not.toHaveBeenCalled();
    expect(m.slackDelete).not.toHaveBeenCalled();
  });

  it("edits and deletes in Slack first when the message is bridged", async () => {
    m.bridged = true;
    m.rpc.mockResolvedValue({ data: null, error: null });
    await editChatMessage(MESSAGE, "new");
    await deleteChatMessage(MESSAGE);
    expect(m.slackUpdate).toHaveBeenCalled();
    expect(m.slackDelete).toHaveBeenCalled();
  });

  it("has nothing to retry", async () => {
    await expect(retryChatMessage(MESSAGE)).resolves.toEqual({ ok: false, error: "That message can't be retried." });
    expect(m.sendToSlack).not.toHaveBeenCalled();
  });
});

describe("isHubOnlyMessage", () => {
  const chat = (channels: object[], messages: object[]) => createInMemoryRepos(new InMemoryDataset({ chatChannels: channels as never, chatMessages: messages as never })).chat;

  it("is true for a Hub-written message in a channel with no Slack channel, false otherwise", async () => {
    const dm = { id: CHANNEL, kind: "dm", visibility: "private", restricted: true, bridge_mode: "app_only", slack_channel_id: null };
    const bridged = { id: "chn_AAAAAAAAAAC2", kind: "channel", visibility: "public", restricted: false, slack_channel_id: "C2" };
    const repo = chat([dm, bridged], [
      { id: MESSAGE, channel_id: CHANNEL, origin: "app" },
      { id: "msg_AAAAAAAAAAD2", channel_id: "chn_AAAAAAAAAAC2", origin: "app" },
      { id: "msg_AAAAAAAAAAD3", channel_id: CHANNEL, origin: "slack" },
    ]);
    expect(await isHubOnlyMessage(repo, MESSAGE)).toBe(true);
    expect(await isHubOnlyMessage(repo, "msg_AAAAAAAAAAD2")).toBe(false);
    expect(await isHubOnlyMessage(repo, "msg_AAAAAAAAAAD3")).toBe(false);
    expect(await isHubOnlyMessage(repo, "msg_AAAAAAAAAAD9")).toBe(false);
  });

  it("is false when the message can't be read", async () => {
    expect(await isHubOnlyMessage({ slackTarget: async () => { throw new Error("db down"); } }, MESSAGE)).toBe(false);
  });
});

describe("membershipAbilities for a Hub direct message", () => {
  it("explains that a direct message is between two people", () => {
    const abilities = membershipAbilities({
      kind: "dm", visibility: "private", archived: false, joined: true, isSudo: false, isStaff: false,
      bridge: { bridge_mode: "app_only", bridge_disabled: false, bridge_status: "ok" }, slackChannelId: null,
    });
    expect(abilities.blocked).toBe("A direct message is between the two of you.");
    expect(abilities.canAdd).toBe(false);
  });
});
