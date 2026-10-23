import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  postingCaller: vi.fn(),
  chatCaller: vi.fn(),
  loadChannelForMember: vi.fn(),
  invite: vi.fn(),
  kick: vi.fn(),
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
  slackUserIdsFor: m.slackIds,
}));
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

type Call = { method: string; args: unknown[] };
type Query = { table: string; calls: Call[] };
const queries: Query[] = [];
let answer: (q: Query) => unknown;
vi.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      const q: Query = { table, calls: [] };
      queries.push(q);
      const chain: Record<string, unknown> = new Proxy(
        {},
        {
          get(_t, prop: string) {
            if (prop === "then") return (resolve: (v: unknown) => void, reject: (e: unknown) => void) => Promise.resolve(answer(q)).then(resolve, reject);
            if (prop === "maybeSingle") return () => Promise.resolve(answer(q));
            return (...args: unknown[]) => {
              q.calls.push({ method: prop, args });
              return chain;
            };
          },
        }
      );
      return chain;
    },
  }),
}));

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
  membershipRow: { source: string } | null;
}
let world: World;
const has = (q: Query, method: string, ...args: unknown[]) => q.calls.some((c) => c.method === method && args.every((a, i) => JSON.stringify(c.args[i]) === JSON.stringify(a)));
const withMethod = (table: string, method: string) => queries.filter((q) => q.table === table && has(q, method));
const writes = (method: "upsert" | "update") => withMethod("chat_channel_members", method).map((q) => q.calls.find((c) => c.method === method)!.args[0]);

beforeEach(() => {
  queries.length = 0;
  m.actionNames.length = 0;
  m.role.current = "member";
  world = {
    channelRow: { kind: "channel", visibility: "public", slack_channel_id: "C_SLACK", bridge_mode: "bridged", bridge_disabled: false, bridge_status: "ok", archived_at: null },
    summary: { label: "#general", joined: true },
    present: [],
    active: [FERN, GALE, HAZEL],
    directory: [
      { id: GALE, name: "Gale Prickleton", display_name: null, photo_url: "https://photos.example.test/gale.jpg" },
      { id: HAZEL, name: "Hazel Burrows", display_name: "Hazel", photo_url: null },
    ],
    membershipRow: { source: "slack" },
  };
  answer = (q) => {
    if (q.table === "chat_channels") return { data: world.channelRow };
    if (q.table === "chat_channel_members") {
      if (has(q, "upsert") || has(q, "update")) return { error: null };
      if (q.calls.some((c) => c.method === "in" && c.args[0] === "member_id")) return { data: world.present.map((member_id) => ({ member_id })) };
      return { data: world.membershipRow };
    }
    if (q.table === "members") return { data: world.active.map((id) => ({ id })) };
    if (q.table === "member_directory") return { data: world.directory };
    return { data: null };
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
  m.kick.mockResolvedValue({ ok: true });
  m.slackIds.mockReset();
  m.slackIds.mockResolvedValue(new Map([[GALE, "U_GALE"], [HAZEL, "U_HAZEL"], [FERN, "U_FERN"]]));
});

describe("addChatMembers", () => {
  it("adds them in Slack as the bot, then records them here with their Slack ids behind it", async () => {
    await expect(addChatMembers(CHANNEL, [GALE, HAZEL])).resolves.toEqual({ ok: true, message: undefined });

    expect(m.invite).toHaveBeenCalledWith({ channel: "C_SLACK", userIds: ["U_GALE", "U_HAZEL"] });
    expect(writes("upsert")).toEqual([
      [
        expect.objectContaining({ channel_id: CHANNEL, member_id: GALE, left_at: null, source: "slack" }),
        expect.objectContaining({ channel_id: CHANNEL, member_id: HAZEL, left_at: null, source: "slack" }),
      ],
    ]);
    expect(m.invite.mock.invocationCallOrder[0]).toBeLessThan(m.postingCaller.mock.invocationCallOrder[0] + 1000);
    expect(m.actionNames).toEqual(["chat_members_added"]);
  });

  it("leaves everything as it was when Slack refuses", async () => {
    m.invite.mockResolvedValue({ ok: false, error: "Billie Bot isn't in this conversation, so it can't add people." });
    await expect(addChatMembers(CHANNEL, [GALE])).resolves.toEqual({ ok: false, error: expect.stringContaining("Billie Bot isn't in") });
    expect(writes("upsert")).toHaveLength(0);
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
    expect(writes("upsert")[0]).toEqual([expect.objectContaining({ member_id: GALE, source: "slack" }), expect.objectContaining({ member_id: HAZEL, source: "app" })]);
  });

  it("refuses to add someone who isn't in Slack to a private channel, by name, before touching anything", async () => {
    world.channelRow = { ...world.channelRow, visibility: "private" };
    m.slackIds.mockResolvedValue(new Map([[GALE, "U_GALE"]]));

    const result = await addChatMembers(CHANNEL, [GALE, HAZEL]);

    expect(result).toEqual({ ok: false, error: "Hazel isn't in Slack, so can't be added to a private conversation." });
    expect(m.invite).not.toHaveBeenCalled();
    expect(writes("upsert")).toHaveLength(0);
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
  it("lets a member leave: removed in Slack, then here", async () => {
    await expect(removeChatMember(CHANNEL, FERN)).resolves.toEqual({ ok: true });

    expect(m.kick).toHaveBeenCalledWith({ channel: "C_SLACK", userId: "U_FERN" });
    expect(writes("update")).toEqual([expect.objectContaining({ left_at: expect.any(String) })]);
    expect(m.actionNames).toEqual(["chat_member_removed"]);
  });

  it("keeps them in when Slack won't remove them", async () => {
    m.kick.mockResolvedValue({ ok: false, error: "Slack doesn't allow removing people from the workspace's default channel." });
    await expect(removeChatMember(CHANNEL, FERN)).resolves.toEqual({ ok: false, error: expect.stringContaining("default channel") });
    expect(writes("update")).toHaveLength(0);
  });

  it("is for staff when it is someone else", async () => {
    await expect(removeChatMember(CHANNEL, GALE)).resolves.toEqual({ ok: false, error: "Only staff can remove other people from a conversation." });
    expect(m.kick).not.toHaveBeenCalled();

    m.role.current = "admin";
    await expect(removeChatMember(CHANNEL, GALE)).resolves.toEqual({ ok: true });
    expect(m.kick).toHaveBeenCalledWith({ channel: "C_SLACK", userId: "U_GALE" });
  });

  it("doesn't call Slack for someone only the Hub knows is in it, and does nothing for someone already out", async () => {
    world.membershipRow = { source: "app" };
    await expect(removeChatMember(CHANNEL, FERN)).resolves.toEqual({ ok: true });
    expect(m.kick).not.toHaveBeenCalled();
    expect(writes("update")).toHaveLength(1);

    queries.length = 0;
    world.membershipRow = null;
    await expect(removeChatMember(CHANNEL, FERN)).resolves.toEqual({ ok: true });
    expect(m.kick).not.toHaveBeenCalled();
    expect(writes("update")).toHaveLength(0);
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

  it("searches names and display names with two queries, and treats % and _ as the letters they are", async () => {
    await searchMembersToAdd(CHANNEL, "50%_off, id.eq.x");
    const search = queries.filter((q) => q.table === "member_directory");
    expect(search).toHaveLength(2);
    expect(search.map((q) => q.calls.find((c) => c.method === "ilike")!.args[0]).sort()).toEqual(["display_name", "name"]);
    expect(search[0].calls.find((c) => c.method === "ilike")!.args[1]).toBe("%50\\%\\_off, id.eq.x%");
    expect(search.every((q) => !q.calls.some((c) => c.method === "or"))).toBe(true);
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
