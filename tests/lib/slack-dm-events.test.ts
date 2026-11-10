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

import { decideDmEvent, isSlackDmChannelId } from "@/lib/chat/slack-dm-events";
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
