import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  postingCaller: vi.fn(),
  loadChannelForMember: vi.fn(),
  loadChannelMembers: vi.fn(),
  loadChatChannels: vi.fn(),
  slackIds: vi.fn(),
  directory: { rows: [] as { id: string; name: string; display_name: string | null; photo_url: string | null }[], typed: [] as string[] },
  inactive: new Set<string>(),
}));
vi.mock("@/lib/chat/caller", () => ({ postingCaller: m.postingCaller }));
vi.mock("@/lib/chat/load", () => ({
  loadChannelForMember: m.loadChannelForMember,
  loadChannelMembers: m.loadChannelMembers,
  loadChatChannels: m.loadChatChannels,
}));
vi.mock("@/lib/chat/slack-membership", () => ({ slackUserIdsFor: m.slackIds }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ supabase: true }) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));
// The directory's own matching (name or display name, wildcards as letters) is in its repository contract; here it is a stand-in.
vi.mock("@/lib/data/repos", () => ({
  createRepos: () => ({
    members: { byIds: async (ids: string[]) => ids.map((id) => ({ id, status: m.inactive.has(id) ? "cancelled" : "active" })) },
    directory: {
      matching: async (typed: string, limit: number) => {
        m.directory.typed.push(typed);
        const needle = typed.toLowerCase();
        return m.directory.rows.filter((r) => r.name.toLowerCase().includes(needle) || (r.display_name ?? "").toLowerCase().includes(needle)).slice(0, limit);
      },
    },
  }),
}));

import { suggestMentions } from "@/app/(member)/chat/mention-actions";

const CHANNEL = "chn_AAAAAAAAAAC1";
const FERN = "mbr_AAAAAAAAAAF1";
const person = (n: number, name: string) => ({ memberId: `mbr_AAAAAAAAAAF${n}`, name, photoUrl: null });

beforeEach(() => {
  m.postingCaller.mockReset();
  m.postingCaller.mockResolvedValue({ identity: { memberId: FERN, isSudo: false } });
  m.loadChannelForMember.mockReset();
  m.loadChannelForMember.mockResolvedValue({ id: CHANNEL });
  m.loadChannelMembers.mockReset();
  m.loadChannelMembers.mockResolvedValue([person(1, "Fern Quillsby"), person(2, "Gale Prickleton"), person(3, "Ania Ray"), person(4, "Mary Gale"), person(5, "No Slack")]);
  m.loadChatChannels.mockReset();
  m.loadChatChannels.mockResolvedValue([
    { kind: "channel", label: "#general", archived: false, slackChannelId: "C_GEN" },
    { kind: "channel", label: "#book-general", archived: false, slackChannelId: "C_BOOK" },
    { kind: "channel", label: "#old-general", archived: true, slackChannelId: "C_OLD" },
    { kind: "channel", label: "#unbridged-general", archived: false, slackChannelId: null },
    { kind: "group_dm", label: "Gale, Ania", archived: false, slackChannelId: "G_DM" },
  ]);
  m.directory.rows = [];
  m.directory.typed = [];
  m.inactive.clear();
  m.slackIds.mockReset();
  m.slackIds.mockImplementation(async (_s: unknown, ids: string[]) => new Map(ids.filter((id) => !id.endsWith("F5")).map((id) => [id, `U_${id.slice(-2)}`])));
});

describe("suggestMentions", () => {
  it("offers people in the conversation who match, best match first, as Slack mentions, never the member themselves or someone with no Slack account", async () => {
    const found = await suggestMentions(CHANNEL, "@", "gale");
    expect(found.map((s) => s.label)).toEqual(["@Gale Prickleton", "@Mary Gale"]);
    expect(found[0].token).toBe("<@U_F2>");
    expect(await suggestMentions(CHANNEL, "@", "slack")).toEqual([]);
    expect(await suggestMentions(CHANNEL, "@", "fern")).toEqual([]);
  });

  it("searches the whole directory for what is typed, not just this conversation, people here first, active members only", async () => {
    m.directory.rows = [
      { id: "mbr_AAAAAAAAAAG1", name: "Gale Outsider", display_name: null, photo_url: null },
      { id: "mbr_AAAAAAAAAAG2", name: "Gale Gone", display_name: null, photo_url: null },
      { id: "mbr_AAAAAAAAAAF2", name: "Gale Prickleton", display_name: null, photo_url: null },
    ];
    m.inactive.add("mbr_AAAAAAAAAAG2");
    const found = await suggestMentions(CHANNEL, "@", "gale");
    expect(found.map((s) => s.label)).toEqual(["@Gale Prickleton", "@Mary Gale", "@Gale Outsider"]);
    expect(found[2].token).toBe("<@U_G1>");
  });

  it("matches a display name, and passes what was typed on as it was typed", async () => {
    m.directory.rows = [{ id: "mbr_AAAAAAAAAAG3", name: "Rosalind Franklin", display_name: "Roz", photo_url: null }];
    expect((await suggestMentions(CHANNEL, "@", "roz")).map((s) => s.label)).toEqual(["@Roz"]);
    await suggestMentions(CHANNEL, "@", "50%_off");
    expect(m.directory.typed).toContain("50%_off");
  });

  it("offers everyone here for a bare @, up to six, without searching the directory", async () => {
    m.loadChannelMembers.mockResolvedValue(Array.from({ length: 12 }, (_, i) => person(10 + i, `Person ${String(i).padStart(2, "0")}`)));
    expect(await suggestMentions(CHANNEL, "@", "")).toHaveLength(6);
    expect(m.directory.typed).toEqual([]);
  });

  it("offers channels the member can see that match, bridged and not archived, as Slack channels", async () => {
    const found = await suggestMentions(CHANNEL, "#", "gen");
    expect(found).toEqual([
      { label: "#general", token: "<#C_GEN>", photoUrl: null },
      { label: "#book-general", token: "<#C_BOOK>", photoUrl: null },
    ]);
  });

  it("offers nothing without the posting preview, for a conversation the member can't read, or for a bad id or trigger", async () => {
    m.loadChannelForMember.mockResolvedValue(null);
    expect(await suggestMentions(CHANNEL, "@", "an")).toEqual([]);
    m.loadChannelForMember.mockResolvedValue({ id: CHANNEL });
    m.postingCaller.mockResolvedValue(null);
    expect(await suggestMentions(CHANNEL, "@", "an")).toEqual([]);
    m.postingCaller.mockResolvedValue({ identity: { memberId: FERN, isSudo: false } });
    expect(await suggestMentions("nope", "@", "an")).toEqual([]);
    expect(await suggestMentions(CHANNEL, "!" as "@", "an")).toEqual([]);
  });
});
