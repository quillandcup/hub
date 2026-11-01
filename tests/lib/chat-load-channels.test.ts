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
      ["Gale Prickleton", true, false],
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
    });
    await expect(loadChannelForMember(repos(), GENERAL, HAZEL, false)).resolves.toMatchObject({ label: "#general", joined: false });
    await expect(loadChannelForMember(repos(), OLD, FERN, false)).resolves.toMatchObject({ archived: true });
  });

  it("returns nothing for a private conversation the member isn't in, a missing one, or a group message in sudo", async () => {
    await expect(loadChannelForMember(repos(), SECRET, FERN, false)).resolves.toBeNull();
    await expect(loadChannelForMember(repos(), "chn_AAAAAAAAAAZZ", FERN, false)).resolves.toBeNull();
    await expect(loadChannelForMember(repos(), GROUP, FERN, true)).resolves.toBeNull();
  });

  it("names a group message after the others in it", async () => {
    await expect(loadChannelForMember(repos(), GROUP, FERN, false)).resolves.toMatchObject({ kind: "group_dm", label: "Gale Prickleton" });
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
