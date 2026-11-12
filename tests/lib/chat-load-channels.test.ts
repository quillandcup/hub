import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import type { ChatChannelMemberSeed, ChatChannelSeed } from "@/lib/data/chat";
import { createInMemoryRepos } from "@/lib/data/repos";
import { loadChannelForMember, loadChannelMembers, loadChatChannels } from "@/lib/chat/load";

// The channel and membership reads come from the chat repository (in memory here); `failing` names
// repository methods that throw, to check what an unreadable list shows.
let channels: ChatChannelSeed[];
let memberships: ChatChannelMemberSeed[];
let failing: string[];
/** Bronze: who is in each Slack conversation, and who the Slack users are (a name for the ones that aren't members). */
let slackMembers: { channel_id: string; user_id: string; left_at?: string | null }[] = [];
let slackChannels: { channel_id: string; name: string; is_im?: boolean; is_mpim?: boolean; token_only?: boolean }[] = [];
let slackAuthors: { slack_user_id: string; member_id: string }[] = [];

function repos() {
  const twins = createInMemoryRepos(
    new InMemoryDataset({
      members: [
        { id: FERN, name: "Fern Quillsby", displayName: "Fern", email: "fern@example.test", status: "active" },
        { id: GALE, name: "Gale Prickleton", email: "gale@example.test", status: "active" },
        { id: HAZEL, name: "Hazel Burrows", email: "hazel@example.test", status: "active" },
      ],
      chatChannels: channels,
      chatChannelMembers: memberships,
      slackChannelMembers: slackMembers as never,
      slackChannels: slackChannels as never,
      chatSlackAuthors: slackAuthors as never,
      slackUsers: [
        { user_id: "U_STRANGER", real_name: "Stella Stranger", name: "stella" },
        { user_id: "U_BOT", real_name: "Billie Bot", name: "billie", is_bot: true },
      ] as never,
    })
  );
  for (const method of failing) (twins.chat as unknown as Record<string, unknown>)[method] = async () => { throw new Error(`${method} failed`); };
  return twins;
}

const FERN = "mbr_AAAAAAAAAAF1";
const GALE = "mbr_AAAAAAAAAAF2";
const HAZEL = "mbr_AAAAAAAAAAF3";
const GENERAL = "chn_AAAAAAAAAAC1";
const HOSTS = "chn_AAAAAAAAAAC2";
const SECRET = "chn_AAAAAAAAAAC3";
const GROUP = "chn_AAAAAAAAAAC4";
const OLD = "chn_AAAAAAAAAAC5";

beforeEach(() => {
  failing = [];
  slackMembers = [];
  slackChannels = [];
  slackAuthors = [];
  channels = [
    { id: GENERAL, kind: "channel", visibility: "public", restricted: false, name: "general", slack_channel_id: "C_GENERAL" },
    { id: HOSTS, kind: "channel", visibility: "private", restricted: false, name: "hosts", slack_channel_id: "C_HOSTS" },
    { id: SECRET, kind: "channel", visibility: "private", restricted: false, name: "secret" },
    { id: GROUP, kind: "group_dm", visibility: "private", restricted: true, name: null },
    { id: OLD, kind: "channel", visibility: "public", restricted: false, name: "old", archived_at: "2026-01-01T00:00:00Z" },
  ];
  memberships = [
    { channel_id: HOSTS, member_id: FERN },
    { channel_id: GROUP, member_id: FERN },
    { channel_id: GROUP, member_id: GALE },
    { channel_id: GROUP, member_id: HAZEL, left_at: "2026-02-01T00:00:00Z" },
    { channel_id: GENERAL, member_id: GALE },
    { channel_id: GENERAL, member_id: FERN },
  ];
});

describe("loadChatChannels", () => {
  it("lists public channels and the conversations the member is in, channels first, archived last", async () => {
    const list = await loadChatChannels(repos(), FERN, false);

    expect(list.map((c) => [c.label, c.joined, c.archived])).toEqual([
      ["#general", true, false],
      ["#hosts", true, false],
      ["Gale Prickleton (group)", true, false],
      ["#old", false, true],
    ]);
    expect(list.find((c) => c.id === HOSTS)).toMatchObject({ visibility: "private", slackChannelId: "C_HOSTS", restricted: false });
  });

  it("hides group messages while viewing as someone else (sudo)", async () => {
    const list = await loadChatChannels(repos(), FERN, true);
    expect(list.map((c) => c.id)).toEqual([GENERAL, HOSTS, OLD]);
  });

  it("lists nothing when the channels can't be read, and no joined state when the memberships can't", async () => {
    failing = ["listChannels"];
    await expect(loadChatChannels(repos(), FERN, false)).resolves.toEqual([]);

    failing = ["joinedChannelIds"];
    const list = await loadChatChannels(repos(), FERN, false);
    expect(list.map((c) => c.id)).toEqual([GENERAL, OLD]);
    expect(list.every((c) => !c.joined)).toBe(true);
  });

  it("labels a group message with the others in it, or generically when that can't be read", async () => {
    failing = ["activeMembersOf"];
    const list = await loadChatChannels(repos(), FERN, false);
    expect(list.find((c) => c.id === GROUP)!.label).toBe("Group message");
  });
});

describe("loadChannelForMember", () => {
  it("returns a channel the member is in, with its state", async () => {
    await expect(loadChannelForMember(repos(), HOSTS, FERN, false)).resolves.toEqual({
      id: HOSTS,
      kind: "channel",
      label: "#hosts",
      visibility: "private",
      restricted: false,
      archived: false,
      joined: true,
      slackChannelId: "C_HOSTS",
      lastMessageAt: null,
    });
    await expect(loadChannelForMember(repos(), GENERAL, HAZEL, false)).resolves.toMatchObject({ label: "#general", joined: false });
    await expect(loadChannelForMember(repos(), OLD, FERN, false)).resolves.toMatchObject({ archived: true });
  });

  it("returns nothing for a private conversation the member isn't in, a missing one, or a group message in sudo", async () => {
    await expect(loadChannelForMember(repos(), SECRET, FERN, false)).resolves.toBeNull();
    await expect(loadChannelForMember(repos(), "chn_AAAAAAAAAAZZ", FERN, false)).resolves.toBeNull();
    await expect(loadChannelForMember(repos(), GROUP, FERN, true)).resolves.toBeNull();
  });

  it("names a group message after the others in it, and says it is a group when there is only one other person", async () => {
    await expect(loadChannelForMember(repos(), GROUP, FERN, false)).resolves.toMatchObject({ kind: "group_dm", label: "Gale Prickleton (group)" });
  });

  it("lists direct and group messages most recently active first, with ones that have no messages last, and channels by name", async () => {
    const DM_A = "chn_AAAAAAAAAAD1";
    const DM_B = "chn_AAAAAAAAAAD2";
    const DM_C = "chn_AAAAAAAAAAD3";
    channels.push(
      { id: DM_A, kind: "dm", visibility: "private", restricted: true, name: null, slack_channel_id: "D_A", last_message_at: "2026-11-08T10:00:00Z" },
      { id: DM_B, kind: "dm", visibility: "private", restricted: true, name: null, slack_channel_id: "D_B", last_message_at: "2026-11-09T09:00:00Z" },
      { id: DM_C, kind: "dm", visibility: "private", restricted: true, name: null, slack_channel_id: "D_C" }
    );
    channels.find((c) => c.id === GROUP)!.last_message_at = "2026-11-09T12:00:00Z";
    memberships.push(
      { channel_id: DM_A, member_id: FERN }, { channel_id: DM_A, member_id: GALE },
      { channel_id: DM_B, member_id: FERN }, { channel_id: DM_B, member_id: HAZEL },
      { channel_id: DM_C, member_id: FERN }, { channel_id: DM_C, member_id: HAZEL }
    );
    const list = await loadChatChannels(repos(), FERN, false);
    expect(list.filter((c) => c.kind !== "channel" && !c.archived).map((c) => c.id)).toEqual([GROUP, DM_B, DM_A, DM_C]);
    expect(list.filter((c) => c.kind === "channel" && !c.archived).map((c) => c.label)).toEqual(["#general", "#hosts"]);
    expect(list.find((c) => c.id === DM_B)!.lastMessageAt).toBe("2026-11-09T09:00:00Z");
  });

  it("names a direct message plainly after the other person, so a group message with the same person reads differently", async () => {
    const DM = "chn_AAAAAAAAAAC6";
    channels.push({ id: DM, kind: "dm", visibility: "private", restricted: true, name: null, slack_channel_id: "D_ONE" });
    memberships.push({ channel_id: DM, member_id: FERN }, { channel_id: DM, member_id: GALE });
    await expect(loadChannelForMember(repos(), DM, FERN, false)).resolves.toMatchObject({ kind: "dm", label: "Gale Prickleton" });
    const labels = (await loadChatChannels(repos(), FERN, false)).filter((c) => c.kind !== "channel").map((c) => c.label).sort();
    expect(labels).toEqual(["Gale Prickleton", "Gale Prickleton (group)"]);
  });

  it("lists only the people in a group message, never Billie Bot, which is in every group and isn't a member", async () => {
    memberships.push({ channel_id: GROUP, member_id: HAZEL });
    const label = (await loadChannelForMember(repos(), GROUP, FERN, false))!.label;
    expect(label).toBe("Gale Prickleton, Hazel Burrows");
    expect(label).not.toMatch(/bot/i);
  });

  it("treats a channel or membership it can't read as not there", async () => {
    failing = ["channelRecord"];
    await expect(loadChannelForMember(repos(), GENERAL, FERN, false)).resolves.toBeNull();

    failing = ["activeMembership"];
    await expect(loadChannelForMember(repos(), GENERAL, FERN, false)).resolves.toMatchObject({ joined: false });
    await expect(loadChannelForMember(repos(), HOSTS, FERN, false)).resolves.toBeNull();
  });
});

describe("loadChannelMembers", () => {
  it("lists who is in a conversation now, A to Z, with their names", async () => {
    await expect(loadChannelMembers(repos(), GENERAL)).resolves.toEqual([
      { memberId: FERN, name: "Fern", photoUrl: null },
      { memberId: GALE, name: "Gale Prickleton", photoUrl: null },
    ]);
    await expect(loadChannelMembers(repos(), GROUP)).resolves.toHaveLength(2);
  });

  it("lists nobody when the members can't be read", async () => {
    failing = ["activeMembersOf"];
    await expect(loadChannelMembers(repos(), GENERAL)).resolves.toEqual([]);
  });
});

describe("labels of Slack direct messages", () => {
  const DM_PAIR = "chn_AAAAAAAAAAE1";
  const DM_STRANGER = "chn_AAAAAAAAAAE2";
  const DM_LONE = "chn_AAAAAAAAAAE3";
  const TOKEN_GROUP = "chn_AAAAAAAAAAE4";

  beforeEach(() => {
    channels.push(
      { id: DM_PAIR, kind: "dm", visibility: "private", restricted: true, name: null, slack_channel_id: "D_PAIR" },
      { id: DM_STRANGER, kind: "dm", visibility: "private", restricted: true, name: null, slack_channel_id: "D_STRANGER" },
      { id: DM_LONE, kind: "dm", visibility: "private", restricted: true, name: null, slack_channel_id: "D_LONE" },
      { id: TOKEN_GROUP, kind: "group_dm", visibility: "private", restricted: true, name: null, slack_channel_id: "C_TOKEN_GROUP" }
    );
    // Only Fern has pulled these, so Fern is the only Hub member in any of them.
    memberships.push(...[DM_PAIR, DM_STRANGER, DM_LONE, TOKEN_GROUP].map((channel_id) => ({ channel_id, member_id: FERN })));
    slackAuthors = [
      { slack_user_id: "U_FERN", member_id: FERN },
      { slack_user_id: "U_GALE", member_id: GALE },
      { slack_user_id: "U_HAZEL", member_id: HAZEL },
    ];
    slackChannels = [
      { channel_id: "D_PAIR", name: "", is_im: true },
      { channel_id: "D_STRANGER", name: "", is_im: true },
      { channel_id: "D_LONE", name: "", is_im: true },
      { channel_id: "C_TOKEN_GROUP", name: "", is_mpim: true, token_only: true },
    ];
    slackMembers = [
      { channel_id: "D_PAIR", user_id: "U_FERN" }, { channel_id: "D_PAIR", user_id: "U_GALE" },
      { channel_id: "D_STRANGER", user_id: "U_FERN" }, { channel_id: "D_STRANGER", user_id: "U_STRANGER" },
      { channel_id: "D_LONE", user_id: "U_FERN" },
      { channel_id: "C_TOKEN_GROUP", user_id: "U_FERN" }, { channel_id: "C_TOKEN_GROUP", user_id: "U_GALE" }, { channel_id: "C_TOKEN_GROUP", user_id: "U_HAZEL" },
    ];
  });

  const labelOf = async (id: string) => (await loadChatChannels(repos(), FERN, false)).find((c) => c.id === id)!.label;

  it("names a DM after the other person even though they are not in the chat conversation yet", async () => {
    expect(await labelOf(DM_PAIR)).toBe("Gale Prickleton");
    await expect(loadChannelForMember(repos(), DM_PAIR, FERN, false)).resolves.toMatchObject({ label: "Gale Prickleton" });
  });

  it("names a DM with someone who isn't a member by their Slack name, and one we know nothing of a plain 'Direct message'", async () => {
    expect(await labelOf(DM_STRANGER)).toBe("Stella Stranger");
    slackMembers = slackMembers.filter((m) => m.channel_id !== "D_LONE");
    expect(await labelOf(DM_LONE)).toBe("Direct message");
  });

  it("names a group only members' tokens read after everyone in it but you, which the chat's own member list couldn't", async () => {
    expect(await labelOf(TOKEN_GROUP)).toBe("Gale Prickleton, Hazel Burrows");
  });

  it("names a DM with yourself after you, as Slack does", async () => {
    const SELF = "chn_AAAAAAAAAAE5";
    channels.push({ id: SELF, kind: "dm", visibility: "private", restricted: true, name: null, slack_channel_id: "D_SELF" });
    memberships.push({ channel_id: SELF, member_id: FERN });
    slackChannels.push({ channel_id: "D_SELF", name: "", is_im: true });
    slackMembers.push({ channel_id: "D_SELF", user_id: "U_FERN" });
    expect(await labelOf(SELF)).toBe("Fern");
    // Not when someone else is in it: you are left out of your own DMs' names.
    expect(await labelOf(DM_PAIR)).toBe("Gale Prickleton");
  });

  it("leaves the bot out, and someone who has left", async () => {
    slackMembers.push({ channel_id: "D_PAIR", user_id: "U_BOT" }, { channel_id: "C_TOKEN_GROUP", user_id: "U_STRANGER", left_at: "2026-11-01T00:00:00Z" });
    expect(await labelOf(DM_PAIR)).toBe("Gale Prickleton");
    expect(await labelOf(TOKEN_GROUP)).toBe("Gale Prickleton, Hazel Burrows");
  });

  it("falls back to the chat's own member list when the counterparts can't be read, and a DM to 'Direct message'", async () => {
    failing = ["dmCounterparts"];
    expect(await labelOf(DM_PAIR)).toBe("Direct message");
    expect(await labelOf(GROUP)).toBe("Gale Prickleton (group)");
  });
});
