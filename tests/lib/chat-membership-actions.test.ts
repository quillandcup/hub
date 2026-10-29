import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  postingCaller: vi.fn(),
  chatCaller: vi.fn(),
  loadChannelForMember: vi.fn(),
  invite: vi.fn(),
  kick: vi.fn(),
  leave: vi.fn(),
  kickAs: vi.fn(),
  inviteAs: vi.fn(),
  joinAs: vi.fn(),
  revoke: vi.fn(),
  userToken: vi.fn(),
  slackIds: vi.fn(),
  actionNames: [] as string[],
  role: { current: "member" },
}));

vi.mock("@/lib/analytics/server", () => ({
  withAction: async (name: string, run: () => Promise<unknown>) => {
    m.actionNames.push(name);
    return run();
  },
}));
vi.mock("@/lib/chat/caller", () => ({ postingCaller: m.postingCaller, chatCaller: m.chatCaller }));
vi.mock("@/lib/chat/load", () => ({ loadChannelForMember: m.loadChannelForMember }));
vi.mock("@/lib/chat/slack-membership", () => ({
  inviteToSlackChannel: m.invite,
  kickFromSlackChannel: m.kick,
  leaveSlackChannelAsMember: m.leave,
  kickAsMember: m.kickAs,
  inviteAsMember: m.inviteAs,
  joinAsMember: m.joinAs,
  slackUserIdsFor: m.slackIds,
}));
vi.mock("@/lib/slack-connect", () => ({ getSlackUserToken: m.userToken }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.single = async () => ({ data: { role: m.role.current } });
      return chain;
    },
  }),
}));

// Nothing here queries a table directly: every read and write goes through the repositories.
vi.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: () => ({
    rpc: (...args: unknown[]) => m.revoke(...args),
    from: (table: string) => {
      throw new Error(`direct query on ${table}`);
    },
  }),
}));

// Everything the actions read comes from the repositories, here in memory, built once per test from
// `world` (when it is first asked for): `world.active` are active members, everyone else it mentions is
// cancelled; `world.present` are in the conversation. `world.failing` names repository methods that throw.
let dataset: InstanceType<typeof import("@/lib/data/in-memory").InMemoryDataset> | null = null;
vi.mock("@/lib/data/repos", async () => {
  const actual = await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos");
  const { InMemoryDataset } = await import("@/lib/data/in-memory");
  return {
    ...actual,
    createRepos: () => {
      const ids = [...new Set([FERN, GALE, HAZEL, ...world.active, ...world.directory.map((d) => d.id)])];
      dataset ??= new InMemoryDataset({
        // The caller's profile carries their role (staff are admins).
        userProfiles: [{ id: "auth-fern", email: "fern@example.test", role: m.role.current }],
        // The member directory is these members' public fields, so the world's directory names them.
        members: ids.map((id) => {
          const listed = world.directory.find((d) => d.id === id);
          return {
            id,
            name: listed?.name ?? id,
            displayName: listed?.display_name ?? null,
            photoUrl: listed?.photo_url ?? null,
            email: `${id}@example.test`,
            status: world.active.includes(id) ? "active" : "cancelled",
          };
        }),
        chatChannels: world.channelRow ? [{ id: CHANNEL, ...world.channelRow }] : [],
        chatChannelMembers: world.present.map((member_id) => ({ channel_id: CHANNEL, member_id, source: world.sources[member_id] ?? "slack" })),
      });
      const repos = actual.createInMemoryRepos(dataset);
      for (const method of world.failing) (repos.chat as unknown as Record<string, unknown>)[method] = async () => { throw new Error(`${method} failed`); };
      return repos;
    },
  };
});

import { addChatMembers, joinChatChannel, removeChatMember, searchMembersToAdd } from "@/app/(member)/chat/membership-actions";

const CHANNEL = "chn_AAAAAAAAAAC1";
const FERN = "mbr_AAAAAAAAAAF1";
const GALE = "mbr_AAAAAAAAAAF2";
const HAZEL = "mbr_AAAAAAAAAAF3";

interface World {
  channelRow: Record<string, unknown> | null;
  summary: Record<string, unknown> | null;
  present: string[];
  active: string[];
  directory: { id: string; name: string; display_name: string | null; photo_url: string | null }[];
  /** How some of the members in `present` got in (default: from Slack). */
  sources: Record<string, string>;
  /** Repository methods (on the chat repository) that throw. */
  failing: string[];
}
let world: World;
/** The conversation's membership rows as they are now. */
const rows = () => dataset!.chatChannelMembers;
const leftIds = () => rows().filter((r) => r.left_at).map((r) => r.member_id);

beforeEach(() => {
  dataset = null;
  m.actionNames.length = 0;
  m.role.current = "member";
  world = {
    channelRow: { kind: "channel", visibility: "public", slack_channel_id: "C_SLACK", bridge_mode: "bridged", bridge_disabled: false, bridge_status: "ok", archived_at: null },
    summary: { label: "#general", joined: true },
    present: [],
    active: [FERN, GALE, HAZEL],
    directory: [
      { id: FERN, name: "Fern Quillsby", display_name: "Fern", photo_url: null },
      { id: GALE, name: "Gale Prickleton", display_name: null, photo_url: "https://photos.example.test/gale.jpg" },
      { id: HAZEL, name: "Hazel Burrows", display_name: "Hazel", photo_url: null },
    ],
    sources: {},
    failing: [],
  };
  m.postingCaller.mockReset();
  m.postingCaller.mockResolvedValue({ userId: "auth-fern", identity: { memberId: FERN, isSudo: false } });
  m.chatCaller.mockReset();
  m.chatCaller.mockResolvedValue({ userId: "auth-fern", identity: { memberId: FERN, isSudo: false } });
  m.loadChannelForMember.mockReset();
  m.loadChannelForMember.mockImplementation(async () => world.summary);
  m.invite.mockReset();
  m.invite.mockResolvedValue({ ok: true });
  m.kick.mockReset();
  m.inviteAs.mockReset();
  m.inviteAs.mockResolvedValue({ ok: true });
  m.joinAs.mockReset();
  m.joinAs.mockResolvedValue({ ok: true });
  m.kickAs.mockReset();
  m.kickAs.mockResolvedValue({ ok: true });
  m.revoke.mockReset();
  m.leave.mockReset();
  m.leave.mockResolvedValue({ ok: true });
  m.userToken.mockReset();
  m.userToken.mockResolvedValue(null);
  m.kick.mockResolvedValue({ ok: true });
  m.slackIds.mockReset();
  m.slackIds.mockResolvedValue(new Map([[GALE, "U_GALE"], [HAZEL, "U_HAZEL"], [FERN, "U_FERN"]]));
});

describe("addChatMembers", () => {
  it("adds them in Slack as the bot, then records them here with their Slack ids behind it", async () => {
    await expect(addChatMembers(CHANNEL, [GALE, HAZEL])).resolves.toEqual({ ok: true, message: undefined });

    expect(m.invite).toHaveBeenCalledWith({ channel: "C_SLACK", userIds: ["U_GALE", "U_HAZEL"] });
    expect(rows()).toEqual([
      expect.objectContaining({ channel_id: CHANNEL, member_id: GALE, left_at: null, source: "slack" }),
      expect.objectContaining({ channel_id: CHANNEL, member_id: HAZEL, left_at: null, source: "slack" }),
    ]);
    expect(m.invite.mock.invocationCallOrder[0]).toBeLessThan(m.postingCaller.mock.invocationCallOrder[0] + 1000);
    expect(m.actionNames).toEqual(["chat_members_added"]);
  });

  it("leaves everything as it was when Slack refuses", async () => {
    m.invite.mockResolvedValue({ ok: false, error: "Billie Bot isn't in this conversation, so it can't add people." });
    await expect(addChatMembers(CHANNEL, [GALE])).resolves.toEqual({ ok: false, error: expect.stringContaining("Billie Bot isn't in") });
    expect(rows()).toHaveLength(0);
  });

  it("skips people who are already in, and does nothing when everyone is", async () => {
    world.present = [GALE];
    await addChatMembers(CHANNEL, [GALE, HAZEL]);
    expect(m.invite).toHaveBeenCalledWith({ channel: "C_SLACK", userIds: ["U_HAZEL"] });

    m.invite.mockClear();
    world.present = [GALE, HAZEL];
    await expect(addChatMembers(CHANNEL, [GALE, HAZEL])).resolves.toEqual({ ok: true });
    expect(m.invite).not.toHaveBeenCalled();
  });

  it("only adds active members", async () => {
    world.active = [FERN, GALE];
    await expect(addChatMembers(CHANNEL, [GALE, HAZEL])).resolves.toEqual({ ok: false, error: "Only active members can be added." });
    expect(m.invite).not.toHaveBeenCalled();
  });

  it("adds someone who isn't in Slack to a public channel as Hub-only, and says so", async () => {
    m.slackIds.mockResolvedValue(new Map([[GALE, "U_GALE"]]));
    const result = await addChatMembers(CHANNEL, [GALE, HAZEL]);

    expect(result).toEqual({ ok: true, message: expect.stringContaining("One person isn't in Slack") });
    expect(m.invite).toHaveBeenCalledWith({ channel: "C_SLACK", userIds: ["U_GALE"] });
    expect(rows()).toEqual([expect.objectContaining({ member_id: GALE, source: "slack" }), expect.objectContaining({ member_id: HAZEL, source: "app" })]);
  });

  it("refuses to add someone who isn't in Slack to a private channel, by name, before touching anything", async () => {
    world.channelRow = { ...world.channelRow, visibility: "private" };
    m.slackIds.mockResolvedValue(new Map([[GALE, "U_GALE"]]));

    const result = await addChatMembers(CHANNEL, [GALE, HAZEL]);

    expect(result).toEqual({ ok: false, error: "Hazel isn't in Slack, so can't be added to a private conversation." });
    expect(m.invite).not.toHaveBeenCalled();
    expect(rows()).toHaveLength(0);
  });

  it("needs you to be in the conversation to add others, but not to join a public channel yourself", async () => {
    world.summary = { label: "#general", joined: false };
    await expect(addChatMembers(CHANNEL, [GALE])).resolves.toEqual({ ok: false, error: "Join this channel before adding other people to it." });

    await expect(addChatMembers(CHANNEL, [FERN])).resolves.toMatchObject({ ok: true });
    expect(m.invite).toHaveBeenCalledWith({ channel: "C_SLACK", userIds: ["U_FERN"] });
  });

  it("won't let you join a private channel you aren't in", async () => {
    world.summary = { label: "#hosts", joined: false };
    world.channelRow = { ...world.channelRow, visibility: "private" };
    await expect(addChatMembers(CHANNEL, [FERN])).resolves.toEqual({ ok: false, error: "You can only join a public channel. Ask someone in it to add you." });
  });

  it.each([
    ["a direct message", { kind: "dm" }, "group message"],
    ["a group message", { kind: "group_dm" }, "group message"],
    ["an archived conversation", { archived_at: "2026-10-01T00:00:00Z" }, "archived"],
    ["one that isn't bridged", { bridge_mode: "app_only" }, "isn't connected to Slack"],
    ["one the bridge is off for", { bridge_disabled: true }, "isn't connected to Slack"],
    ["one whose bot was removed", { bridge_status: "disconnected" }, "isn't connected to Slack"],
    ["one with no Slack id", { slack_channel_id: null }, "isn't connected to Slack"],
  ])("refuses in %s", async (_label, change, words) => {
    world.channelRow = { ...world.channelRow, ...change };
    await expect(addChatMembers(CHANNEL, [GALE])).resolves.toEqual({ ok: false, error: expect.stringContaining(words) });
    expect(m.invite).not.toHaveBeenCalled();
  });

  it("counts a conversation it can't read as unavailable, and a presence it can't read as nobody being in", async () => {
    world.failing = ["manageSettings"];
    await expect(addChatMembers(CHANNEL, [GALE])).resolves.toEqual({ ok: false, error: "That conversation isn't available." });

    world.failing = ["presentMembers"];
    world.present = [GALE];
    dataset = null;
    await expect(addChatMembers(CHANNEL, [GALE])).resolves.toEqual({ ok: true });
    expect(m.invite).toHaveBeenCalledWith({ channel: "C_SLACK", userIds: ["U_GALE"] });
  });

  it("refuses a conversation the member can't see, bad ids, nobody, too many, and a caller without the preview", async () => {
    world.summary = null;
    await expect(addChatMembers(CHANNEL, [GALE])).resolves.toEqual({ ok: false, error: "That conversation isn't available." });
    world.summary = { label: "#general", joined: true };

    await expect(addChatMembers("nope", [GALE])).resolves.toMatchObject({ ok: false });
    await expect(addChatMembers(CHANNEL, [])).resolves.toMatchObject({ ok: false });
    await expect(addChatMembers(CHANNEL, ["nope"])).resolves.toMatchObject({ ok: false });
    const many = Array.from({ length: 21 }, (_, i) => `mbr_${String(i + 1).replace(/0/g, "A").padStart(12, "B")}`);
    await expect(addChatMembers(CHANNEL, many)).resolves.toEqual({ ok: false, error: "Add at most 20 people at a time." });

    m.postingCaller.mockResolvedValue(null);
    await expect(addChatMembers(CHANNEL, [GALE])).resolves.toMatchObject({ ok: false, error: expect.stringContaining("isn't available to you yet") });
    expect(m.invite).not.toHaveBeenCalled();
  });
});

describe("adding as the member", () => {
  it("adds people as the member when they've connected Slack, and the bot is not involved", async () => {
    m.userToken.mockResolvedValue({ token: "xoxp-test", slackUserId: "U_FERN" });
    await expect(addChatMembers(CHANNEL, [GALE, HAZEL])).resolves.toEqual({ ok: true });
    expect(m.inviteAs).toHaveBeenCalledWith({ channel: "C_SLACK", userIds: ["U_GALE", "U_HAZEL"], token: "xoxp-test" });
    expect(m.invite).not.toHaveBeenCalled();
    expect(rows()).toHaveLength(2);
  });

  it("joins a public channel as the member with a join, not an invite", async () => {
    world.summary = { label: "#general", joined: false };
    m.userToken.mockResolvedValue({ token: "xoxp-test", slackUserId: "U_FERN" });
    await expect(joinChatChannel(CHANNEL)).resolves.toEqual({ ok: true });
    expect(m.joinAs).toHaveBeenCalledWith({ channel: "C_SLACK", token: "xoxp-test" });
    expect(m.inviteAs).not.toHaveBeenCalled();
  });

  it("uses the bot when they haven't connected, or their token can't do it", async () => {
    await addChatMembers(CHANNEL, [GALE]);
    expect(m.invite).toHaveBeenCalledTimes(1);

    m.invite.mockClear();
    dataset = null;
    m.userToken.mockResolvedValue({ token: "xoxp-test", slackUserId: "U_FERN" });
    m.inviteAs.mockResolvedValue({ ok: false, error: "x", retryWithBot: true });
    await expect(addChatMembers(CHANNEL, [GALE])).resolves.toEqual({ ok: true });
    expect(m.invite).toHaveBeenCalledTimes(1);
    expect(m.revoke).not.toHaveBeenCalled();
  });

  it("shows Slack's refusal to their own account instead of overriding it with the bot", async () => {
    m.userToken.mockResolvedValue({ token: "xoxp-test", slackUserId: "U_FERN" });
    m.inviteAs.mockResolvedValue({ ok: false, error: "Slack won't let the people be added to this conversation." });
    await expect(addChatMembers(CHANNEL, [GALE])).resolves.toEqual({ ok: false, error: expect.stringContaining("won't let the people") });
    expect(m.invite).not.toHaveBeenCalled();
    expect(rows()).toHaveLength(0);
  });

  it("disconnects a dead connection, still adds through the bot, and says to reconnect", async () => {
    world.present = [];
    m.userToken.mockResolvedValue({ token: "xoxp-test", slackUserId: "U_FERN" });
    m.inviteAs.mockResolvedValue({ ok: false, error: "x", retryWithBot: true, deadToken: true });
    await expect(addChatMembers(CHANNEL, [GALE])).resolves.toEqual({ ok: true, message: expect.stringContaining("Reconnect Slack in Settings") });
    expect(m.revoke).toHaveBeenCalledWith("slack_connection_revoke", { p_member: FERN });
    expect(m.invite).toHaveBeenCalledTimes(1);

    dataset = null;
    m.invite.mockResolvedValue({ ok: false, error: "Billie Bot isn't in this conversation, so it can't add people." });
    await expect(addChatMembers(CHANNEL, [GALE])).resolves.toEqual({ ok: false, error: expect.stringContaining("Reconnect Slack in Settings") });
  });
});

describe("joinChatChannel", () => {
  it("adds the member themselves, as a join", async () => {
    await expect(joinChatChannel(CHANNEL)).resolves.toMatchObject({ ok: true });
    expect(m.invite).toHaveBeenCalledWith({ channel: "C_SLACK", userIds: ["U_FERN"] });
    expect(m.actionNames).toEqual(["chat_channel_joined"]);
  });

  it("is closed to someone without chat", async () => {
    m.chatCaller.mockResolvedValue(null);
    await expect(joinChatChannel(CHANNEL)).resolves.toMatchObject({ ok: false });
    expect(m.invite).not.toHaveBeenCalled();
  });
});

describe("removeChatMember", () => {
  beforeEach(() => {
    world.present = [FERN, GALE];
  });

  it("lets a member leave: removed in Slack, then here", async () => {
    await expect(removeChatMember(CHANNEL, FERN)).resolves.toEqual({ ok: true });

    expect(m.kick).toHaveBeenCalledWith({ channel: "C_SLACK", userId: "U_FERN" });
    expect(leftIds()).toEqual([FERN]);
    expect(rows().find((r) => r.member_id === FERN)!.left_at).toEqual(expect.any(String));
    expect(m.actionNames).toEqual(["chat_member_removed"]);
  });

  it("leaves as themselves when they've connected Slack, so a workspace rule on removing people can't stop them", async () => {
    m.userToken.mockResolvedValue({ token: "xoxp-test", slackUserId: "U_FERN" });
    await expect(removeChatMember(CHANNEL, FERN)).resolves.toEqual({ ok: true });
    expect(m.leave).toHaveBeenCalledWith({ channel: "C_SLACK", token: "xoxp-test" });
    expect(m.kick).not.toHaveBeenCalled();
    expect(leftIds()).toEqual([FERN]);
  });

  it("falls back to the bot when their own token is no good, and says so when leaving fails otherwise", async () => {
    m.userToken.mockResolvedValue({ token: "xoxp-test", slackUserId: "U_FERN" });
    m.leave.mockResolvedValue({ ok: false, error: "x", retryWithBot: true });
    await expect(removeChatMember(CHANNEL, FERN)).resolves.toEqual({ ok: true });
    expect(m.kick).toHaveBeenCalledWith({ channel: "C_SLACK", userId: "U_FERN" });

    m.kick.mockClear();
    dataset = null;
    m.leave.mockResolvedValue({ ok: false, error: "Slack didn't let you leave." });
    await expect(removeChatMember(CHANNEL, FERN)).resolves.toEqual({ ok: false, error: "Slack didn't let you leave." });
    expect(m.kick).not.toHaveBeenCalled();
  });

  it("has staff remove someone else with their own Slack account when connected, never the removed person's", async () => {
    m.userToken.mockResolvedValue({ token: "xoxp-staff", slackUserId: "U_FERN" });
    m.role.current = "admin";
    await expect(removeChatMember(CHANNEL, GALE)).resolves.toEqual({ ok: true });
    expect(m.userToken).toHaveBeenCalledWith(expect.anything(), FERN);
    expect(m.kickAs).toHaveBeenCalledWith({ channel: "C_SLACK", userId: "U_GALE", token: "xoxp-staff" });
    expect(m.kick).not.toHaveBeenCalled();
  });

  it("has staff use the bot when they haven't connected Slack, or their account can't reach it", async () => {
    m.role.current = "admin";
    await removeChatMember(CHANNEL, GALE);
    expect(m.kick).toHaveBeenCalledWith({ channel: "C_SLACK", userId: "U_GALE" });

    m.kick.mockClear();
    dataset = null;
    m.userToken.mockResolvedValue({ token: "xoxp-staff", slackUserId: "U_FERN" });
    m.kickAs.mockResolvedValue({ ok: false, error: "x", retryWithBot: true });
    await expect(removeChatMember(CHANNEL, GALE)).resolves.toEqual({ ok: true });
    expect(m.kick).toHaveBeenCalled();
    expect(m.revoke).not.toHaveBeenCalled();
  });

  it("shows Slack's refusal to a staff member's own account instead of overriding it with the bot", async () => {
    m.role.current = "admin";
    m.userToken.mockResolvedValue({ token: "xoxp-staff", slackUserId: "U_FERN" });
    m.kickAs.mockResolvedValue({ ok: false, error: "Your Slack workspace doesn't let you remove people from this channel." });
    await expect(removeChatMember(CHANNEL, GALE)).resolves.toEqual({ ok: false, error: expect.stringContaining("doesn't let you") });
    expect(m.kick).not.toHaveBeenCalled();
  });

  it("disconnects a dead Slack connection and says to reconnect, whether the bot then manages or not", async () => {
    m.userToken.mockResolvedValue({ token: "xoxp-test", slackUserId: "U_FERN" });
    m.leave.mockResolvedValue({ ok: false, error: "x", retryWithBot: true, deadToken: true });
    await expect(removeChatMember(CHANNEL, FERN)).resolves.toEqual({ ok: true, message: expect.stringContaining("Reconnect Slack in Settings") });
    expect(m.revoke).toHaveBeenCalledWith("slack_connection_revoke", { p_member: FERN });

    dataset = null;
    m.kick.mockResolvedValue({ ok: false, error: "Slack won't let that person be removed." });
    await expect(removeChatMember(CHANNEL, FERN)).resolves.toEqual({ ok: false, error: expect.stringContaining("Reconnect Slack in Settings") });
  });

  it("keeps them in when Slack won't remove them", async () => {
    m.kick.mockResolvedValue({ ok: false, error: "Slack doesn't allow removing people from the workspace's default channel." });
    await expect(removeChatMember(CHANNEL, FERN)).resolves.toEqual({ ok: false, error: expect.stringContaining("default channel") });
    expect(leftIds()).toEqual([]);
  });

  it("is for staff when it is someone else", async () => {
    await expect(removeChatMember(CHANNEL, GALE)).resolves.toEqual({ ok: false, error: "Only staff can remove other people from a conversation." });
    expect(m.kick).not.toHaveBeenCalled();

    dataset = null;
    m.role.current = "admin";
    await expect(removeChatMember(CHANNEL, GALE)).resolves.toEqual({ ok: true });
    expect(m.kick).toHaveBeenCalledWith({ channel: "C_SLACK", userId: "U_GALE" });
  });

  it("doesn't call Slack for someone only the Hub knows is in it, and does nothing for someone already out", async () => {
    world.sources = { [FERN]: "app" };
    await expect(removeChatMember(CHANNEL, FERN)).resolves.toEqual({ ok: true });
    expect(m.kick).not.toHaveBeenCalled();
    expect(leftIds()).toEqual([FERN]);

    dataset = null;
    world.present = [];
    await expect(removeChatMember(CHANNEL, FERN)).resolves.toEqual({ ok: true });
    expect(m.kick).not.toHaveBeenCalled();
    expect(leftIds()).toEqual([]);
  });

  it("treats a membership it can't read as already out", async () => {
    world.failing = ["activeMembership"];
    await expect(removeChatMember(CHANNEL, FERN)).resolves.toEqual({ ok: true });
    expect(m.kick).not.toHaveBeenCalled();
    expect(leftIds()).toEqual([]);
  });

  it("leaving a conversation you're not in is already done", async () => {
    world.summary = { label: "#general", joined: false };
    await expect(removeChatMember(CHANNEL, FERN)).resolves.toEqual({ ok: true });
    expect(m.kick).not.toHaveBeenCalled();
  });

  it("refuses bad ids, a group message, and a caller without the preview", async () => {
    await expect(removeChatMember("nope", FERN)).resolves.toMatchObject({ ok: false });
    await expect(removeChatMember(CHANNEL, "nope")).resolves.toMatchObject({ ok: false });
    world.channelRow = { ...world.channelRow, kind: "group_dm" };
    await expect(removeChatMember(CHANNEL, FERN)).resolves.toMatchObject({ ok: false, error: expect.stringContaining("group message") });
    m.postingCaller.mockResolvedValue(null);
    await expect(removeChatMember(CHANNEL, FERN)).resolves.toMatchObject({ ok: false, error: expect.stringContaining("isn't available to you yet") });
    expect(m.kick).not.toHaveBeenCalled();
  });
});

describe("searchMembersToAdd", () => {
  it("offers active members who match and aren't in it yet, with whether they're in Slack", async () => {
    world.present = [HAZEL];
    m.slackIds.mockResolvedValue(new Map([[GALE, "U_GALE"]]));
    world.directory = [...world.directory, { id: FERN, name: "Fern Quillsby", display_name: null, photo_url: null }];

    const found = await searchMembersToAdd(CHANNEL, "  a  ");
    expect(found).toEqual([]); // too short to search (two letters)

    const results = await searchMembersToAdd(CHANNEL, "ale");
    expect(results).toEqual([{ memberId: GALE, name: "Gale Prickleton", photoUrl: "https://photos.example.test/gale.jpg", inSlack: true }]);
  });

  it("leaves out people who aren't active, and takes the display name when there is one", async () => {
    world.active = [FERN, HAZEL];
    const results = await searchMembersToAdd(CHANNEL, "haz");
    expect(results).toEqual([{ memberId: HAZEL, name: "Hazel", photoUrl: null, inSlack: true }]);
  });

  it("searches names and display names, and treats % and _ (and commas) as the letters they are", async () => {
    const LITERAL = "mbr_AAAAAAAAAAF4";
    const LOOKALIKE = "mbr_AAAAAAAAAAF5";
    world.directory = [
      ...world.directory,
      { id: LITERAL, name: "Wren 50%_off, id.eq.x", display_name: null, photo_url: null },
      { id: LOOKALIKE, name: "Wren 50xyoff, id.eq.x", display_name: null, photo_url: null },
    ];
    world.active = [...world.active, LITERAL, LOOKALIKE];
    m.slackIds.mockResolvedValue(new Map());

    const results = await searchMembersToAdd(CHANNEL, "50%_off, id.eq.x");

    expect(results.map((r) => r.memberId)).toEqual([LITERAL]);
  });

  it("offers nothing to someone who isn't in the conversation or can't change it", async () => {
    world.summary = { label: "#general", joined: false };
    await expect(searchMembersToAdd(CHANNEL, "gale")).resolves.toEqual([]);
    world.summary = { label: "#general", joined: true };
    m.postingCaller.mockResolvedValue(null);
    await expect(searchMembersToAdd(CHANNEL, "gale")).resolves.toEqual([]);
    await expect(searchMembersToAdd("nope", "gale")).resolves.toEqual([]);
  });

  it("offers at most eight", async () => {
    const people = Array.from({ length: 12 }, (_, i) => ({ id: `mbr_${String(i + 101).replace(/0/g, "A").padStart(12, "B")}`, name: `Person ${String(i).padStart(2, "0")}`, display_name: null, photo_url: null }));
    world.directory = people;
    world.active = people.map((p) => p.id);
    m.slackIds.mockResolvedValue(new Map());
    expect(await searchMembersToAdd(CHANNEL, "person")).toHaveLength(8);
  });
});

const notices = () => dataset!.chatMessages.filter((x) => x.system_subtype);
const noticeBodies = () => notices().map((x) => dataset!.chatMessageContents.find((c) => c.message_id === x.id)?.body);

describe("lines in the conversation for what Slack doesn't announce", () => {
  it("says who removed someone, as the person's own line, since Slack posts nothing for a removal", async () => {
    world.present = [FERN, GALE];
    m.role.current = "admin";
    await expect(removeChatMember(CHANNEL, GALE)).resolves.toEqual({ ok: true });
    expect(notices()).toEqual([expect.objectContaining({ channel_id: CHANNEL, author_member_id: GALE, origin: "app", system_subtype: "channel_leave" })]);
    expect(noticeBodies()).toEqual(["was removed from the channel by Fern"]);
  });

  it("leaves a member's own leave to Slack's notice, when Slack was told", async () => {
    world.present = [FERN];
    await expect(removeChatMember(CHANNEL, FERN)).resolves.toEqual({ ok: true });
    expect(notices()).toEqual([]);
  });

  it("writes the line itself for a leave only the Hub knows about", async () => {
    world.present = [FERN];
    world.sources = { [FERN]: "app" };
    await removeChatMember(CHANNEL, FERN);
    expect(notices()).toEqual([expect.objectContaining({ author_member_id: FERN, system_subtype: "channel_leave" })]);
    expect(noticeBodies()).toEqual(["has left the channel"]);
  });

  it("writes the line for someone added only in the Hub, and none for ones Slack announces", async () => {
    m.slackIds.mockResolvedValue(new Map([[GALE, "U_GALE"]]));
    await addChatMembers(CHANNEL, [GALE, HAZEL]);
    expect(notices()).toEqual([expect.objectContaining({ author_member_id: HAZEL, system_subtype: "channel_join" })]);
    expect(noticeBodies()).toEqual(["was added to the channel by Fern"]);
  });

  it("says a Hub-only person joined, not that they were added, when they added themselves", async () => {
    world.summary = { label: "#general", joined: false };
    m.slackIds.mockResolvedValue(new Map());
    await joinChatChannel(CHANNEL);
    expect(noticeBodies()).toEqual(["has joined the channel"]);
  });

  it("escapes names in the line, and a failure to write it doesn't undo the change", async () => {
    world.present = [FERN, GALE];
    m.role.current = "admin";
    world.directory = [{ id: FERN, name: "Fern <b> & Co", display_name: null, photo_url: null }];
    await removeChatMember(CHANNEL, GALE);
    expect(noticeBodies()).toEqual(["was removed from the channel by Fern &lt;b&gt; &amp; Co"]);

    dataset = null;
    world.failing = ["recordMembershipNotice"];
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(removeChatMember(CHANNEL, GALE)).resolves.toEqual({ ok: true });
    expect(leftIds()).toEqual([GALE]);
    expect(notices()).toEqual([]);
    expect(logged).toHaveBeenCalledWith("recording a membership notice failed:", expect.any(Error));
  });
});
