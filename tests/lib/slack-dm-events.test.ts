import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  covered: new Set<string>(),
  scopes: new Map<string, boolean>(),
}));

vi.mock("@/lib/features.server", () => ({
  membersWithFeatureForOutreach: async (_repos: unknown, key: string, ids: string[]) => {
    expect(key).toBe("slack_dm_bridge");
    return new Set(ids.filter((id) => m.covered.has(id)));
  },
}));
vi.mock("@/lib/slack-connect", () => ({
  getSlackConnectionStatus: async (_service: unknown, memberId: string) => ({ hasDmScopes: m.scopes.get(memberId) ?? false }),
}));
let dataset: InstanceType<typeof import("@/lib/data/in-memory").InMemoryDataset>;
vi.mock("@/lib/data/repos", async () => {
  const actual = await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos");
  return { ...actual, createRepos: () => actual.createInMemoryRepos(dataset) };
});

import { decideDmEvent, isMemberTokenConversation, isSlackDmChannelId } from "@/lib/chat/slack-dm-events";
import { InMemoryDataset } from "@/lib/data/in-memory";

const service = {} as never;
const FERN = "mbr_AAAAAAAAAAF1";
const GALE = "mbr_AAAAAAAAAAG1";
const dm = (extra: Record<string, unknown> = {}) => ({
  event: { type: "message", channel: "D1", channel_type: "im", user: "UGALE", text: "hi", ts: "1.1" },
  authorizations: [{ user_id: "UFERN", is_bot: false }],
  ...extra,
});

beforeEach(() => {
  m.covered = new Set([FERN]);
  m.scopes = new Map([[FERN, true]]);
  dataset = new InMemoryDataset({
    chatSlackAuthors: [
      { slack_user_id: "UFERN", member_id: FERN },
      { slack_user_id: "UGALE", member_id: GALE },
    ],
  });
});

describe("isSlackDmChannelId", () => {
  it("is true for a 1:1 DM's id only", () => {
    expect(isSlackDmChannelId("D01ABC")).toBe(true);
    for (const id of ["C01ABC", "G01ABC", "D", "", undefined, null, 5]) expect(isSlackDmChannelId(id)).toBe(false);
  });
});

describe("decideDmEvent", () => {
  it("leaves anything that isn't a DM, a DM with the bot, and an event naming nobody to the old handling", async () => {
    await expect(decideDmEvent(service, { event: { channel: "C1", channel_type: "channel" }, authorizations: [{ user_id: "UFERN" }] })).resolves.toEqual({ kind: "not_dm" });
    await expect(decideDmEvent(service, {})).resolves.toEqual({ kind: "not_dm" });
    await expect(decideDmEvent(service, dm({ authorizations: [{ user_id: "UBOT", is_bot: true }] }))).resolves.toEqual({ kind: "not_dm" });
    await expect(decideDmEvent(service, dm({ authorizations: [] }))).resolves.toEqual({ kind: "not_dm" });
    await expect(decideDmEvent(service, dm({ authorizations: undefined }))).resolves.toEqual({ kind: "not_dm" });
  });

  it("recognizes a DM by its channel id when the event doesn't say its type", async () => {
    m.covered = new Set();
    await expect(decideDmEvent(service, dm({ event: { channel: "D1", ts: "1.1" } }))).resolves.toEqual({ kind: "drop" });
  });

  it("drops a DM no covered member with the DM permissions can see", async () => {
    m.covered = new Set();
    await expect(decideDmEvent(service, dm())).resolves.toEqual({ kind: "drop" });
    m.covered = new Set([FERN]);
    m.scopes = new Map([[FERN, false]]);
    await expect(decideDmEvent(service, dm())).resolves.toEqual({ kind: "drop" });
    // Someone who isn't a member at all (no known Slack id) is dropped too.
    m.scopes = new Map([[FERN, true]]);
    await expect(decideDmEvent(service, dm({ authorizations: [{ user_id: "UNKNOWN" }] }))).resolves.toEqual({ kind: "drop" });
  });

  describe("a reaction delivered on a member's behalf", () => {
    const reaction = (channel: string, extra: Record<string, unknown> = {}) => ({
      event: { type: "reaction_added", user: "UGALE", reaction: "tada", item: { type: "message", channel, ts: "1.1" }, ...extra },
      authorizations: [{ user_id: "UFERN", is_bot: false }],
    });

    it("is kept in a DM the chat has, and pulls for one it hasn't", async () => {
      await expect(decideDmEvent(service, reaction("D1"))).resolves.toEqual({ kind: "pull", memberId: FERN });
      dataset.slackChannels.push({ channel_id: "D1", name: "", is_im: true } as never);
      await expect(decideDmEvent(service, reaction("D1"))).resolves.toEqual({ kind: "keep" });
      await expect(decideDmEvent(service, { ...reaction("D1"), event: { ...reaction("D1").event, type: "reaction_removed" } })).resolves.toEqual({ kind: "keep" });
    });

    it("is dropped when no covered member with the DM permissions can see the DM", async () => {
      m.covered = new Set();
      await expect(decideDmEvent(service, reaction("D1"))).resolves.toEqual({ kind: "drop" });
      m.covered = new Set([FERN]);
      m.scopes = new Map([[FERN, false]]);
      await expect(decideDmEvent(service, reaction("D1"))).resolves.toEqual({ kind: "drop" });
    });

    it("is dropped anywhere else, since the bot's own reaction events cover channels, but a bot's is handled as always", async () => {
      await expect(decideDmEvent(service, reaction("C1"))).resolves.toEqual({ kind: "drop" });
      await expect(decideDmEvent(service, reaction("G1"))).resolves.toEqual({ kind: "drop" });
      await expect(decideDmEvent(service, { ...reaction("C1"), authorizations: [{ user_id: "UBOT", is_bot: true }] })).resolves.toEqual({ kind: "not_dm" });
      await expect(decideDmEvent(service, { ...reaction("C1"), authorizations: [] })).resolves.toEqual({ kind: "not_dm" });
      await expect(decideDmEvent(service, { event: { type: "channel_rename", channel: "C1" }, authorizations: [{ user_id: "UFERN", is_bot: false }] })).resolves.toEqual({ kind: "not_dm" });
    });
  });

  it("keeps a message in a DM the chat already has, for a covered member", async () => {
    dataset.slackChannels.push({ channel_id: "D1", name: "", is_im: true } as never);
    await expect(decideDmEvent(service, dm())).resolves.toEqual({ kind: "keep" });
  });

  it("pulls the member's DMs when the DM is new to us", async () => {
    await expect(decideDmEvent(service, dm())).resolves.toEqual({ kind: "pull", memberId: FERN });
    // A conversation we know that isn't a DM (a channel id mislabelled) is not taken for one.
    dataset.slackChannels.push({ channel_id: "D1", name: "x", is_im: false } as never);
    await expect(decideDmEvent(service, dm())).resolves.toEqual({ kind: "pull", memberId: FERN });
  });
});

describe("decideDmEvent: group DMs", () => {
  const group = (extra: Record<string, unknown> = {}) => ({
    event: { type: "message", channel: "G1", channel_type: "mpim", user: "UGALE", text: "hi", ts: "1.1" },
    authorizations: [{ user_id: "UFERN", is_bot: false }],
    ...extra,
  });

  it("pulls the member's DMs when the group is new to us, keeps one the chat has, and drops it for nobody covered", async () => {
    await expect(decideDmEvent(service, group())).resolves.toEqual({ kind: "pull", memberId: FERN });
    dataset.slackChannels.push({ channel_id: "G1", name: "", is_mpim: true, token_only: true } as never);
    await expect(decideDmEvent(service, group())).resolves.toEqual({ kind: "keep" });
    m.covered = new Set();
    await expect(decideDmEvent(service, group())).resolves.toEqual({ kind: "drop" });
    m.covered = new Set([FERN]);
    m.scopes = new Map([[FERN, false]]);
    await expect(decideDmEvent(service, group())).resolves.toEqual({ kind: "drop" });
  });

  it("leaves a group the bot is in (a bot event) to the old handling", async () => {
    await expect(decideDmEvent(service, group({ authorizations: [{ user_id: "UBOT", is_bot: true }] }))).resolves.toEqual({ kind: "not_dm" });
  });

  it("keeps a user event of a group the bot reads, for a covered member", async () => {
    dataset.slackChannels.push({ channel_id: "G1", name: "x", is_mpim: true, token_only: false } as never);
    await expect(decideDmEvent(service, group())).resolves.toEqual({ kind: "keep" });
  });

  it("reads a reaction's conversation from its item, and only treats a G conversation as a group when it is one", async () => {
    const reaction = (channel: string) => ({ event: { type: "reaction_added", item: { channel }, user: "UGALE" }, authorizations: [{ user_id: "UFERN" }] });
    // A private channel (known, not a group DM) or an unknown G id with no channel type: the bot's own reaction events cover it, so this copy is dropped.
    dataset.slackChannels.push({ channel_id: "G2", name: "private", is_mpim: false } as never);
    await expect(decideDmEvent(service, reaction("G2"))).resolves.toEqual({ kind: "drop" });
    await expect(decideDmEvent(service, reaction("G9"))).resolves.toEqual({ kind: "drop" });
    dataset.slackChannels.push({ channel_id: "G1", name: "", is_mpim: true, token_only: true } as never);
    await expect(decideDmEvent(service, reaction("G1"))).resolves.toEqual({ kind: "keep" });
    await expect(decideDmEvent(service, reaction("D1"))).resolves.toEqual({ kind: "pull", memberId: FERN });
  });

  it("does not look at channels that are neither", async () => {
    await expect(decideDmEvent(service, { event: { type: "message", channel: "C1", channel_type: "channel" }, authorizations: [{ user_id: "UFERN" }] })).resolves.toEqual({ kind: "not_dm" });
  });
});

describe("isMemberTokenConversation", () => {
  it("is true for a 1:1 DM and a token-only group DM, false for anything else", async () => {
    dataset.slackChannels.push(
      { channel_id: "G1", name: "", is_mpim: true, token_only: true } as never,
      { channel_id: "G2", name: "", is_mpim: true, token_only: false } as never
    );
    expect(await isMemberTokenConversation(service, "D1")).toBe(true);
    expect(await isMemberTokenConversation(service, "G1")).toBe(true);
    expect(await isMemberTokenConversation(service, "G2")).toBe(false);
    expect(await isMemberTokenConversation(service, "C1")).toBe(false);
    expect(await isMemberTokenConversation(service, null)).toBe(false);
  });
});
