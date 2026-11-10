import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  caller: vi.fn(),
  features: vi.fn(),
  rows: [] as { id: string; name: string; display_name: string | null }[],
  inactive: new Set<string>(),
  noLogin: new Set<string>(),
}));
vi.mock("@/lib/chat/caller", () => ({ postingCaller: m.caller, dmCaller: m.caller }));
vi.mock("@/lib/features.server", () => ({ getUserFeaturePreviews: m.features, effectiveMemberHasFeature: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));
vi.mock("@/lib/analytics/server", () => ({ withAction: (_n: string, f: () => unknown) => f() }));
vi.mock("@/lib/chat/slack-dms", () => ({ openSlackDm: vi.fn() }));
vi.mock("@/lib/data/repos", () => ({
  createRepos: () => ({
    directory: { matching: async (typed: string) => m.rows.filter((r) => r.name.toLowerCase().includes(typed.toLowerCase())) },
    members: {
      byIds: async (ids: string[]) => ids.map((id) => ({ id, status: m.inactive.has(id) ? "cancelled" : "active" })),
      userIdsByMemberId: async (ids: string[]) => new Map(ids.map((id) => [id, m.noLogin.has(id) ? null : `user-${id}`])),
    },
  }),
}));

import { searchDmCandidates } from "@/app/(member)/chat/dm-actions";

const ME = "mbr_AAAAAAAAAAF1";

beforeEach(() => {
  m.caller.mockReset();
  m.caller.mockResolvedValue({ userId: "u1", identity: { memberId: ME, isSudo: false } });
  m.features.mockReset();
  m.features.mockResolvedValue(["chat_dms"]);
  m.rows = [
    { id: ME, name: "Ada Myself", display_name: null },
    { id: "mbr_AAAAAAAAAAF2", name: "Ada Example", display_name: "Bestie" },
    { id: "mbr_AAAAAAAAAAF3", name: "Ada Gone", display_name: null },
    { id: "mbr_AAAAAAAAAAF4", name: "Ada Nologin", display_name: null },
  ];
  m.inactive = new Set(["mbr_AAAAAAAAAAF3"]);
  m.noLogin = new Set(["mbr_AAAAAAAAAAF4"]);
});

describe("searchDmCandidates", () => {
  it("offers active members with a login, not yourself, by display name with the legal name beside", async () => {
    expect(await searchDmCandidates("ada")).toEqual([{ id: "mbr_AAAAAAAAAAF2", name: "Bestie", detail: "Ada Example" }]);
  });

  it("finds nothing for an empty search, signed out, in sudo, or without a way to message", async () => {
    expect(await searchDmCandidates("  ")).toEqual([]);
    m.caller.mockResolvedValue(null);
    expect(await searchDmCandidates("ada")).toEqual([]);
    m.caller.mockResolvedValue({ userId: "u1", identity: { memberId: ME, isSudo: true } });
    expect(await searchDmCandidates("ada")).toEqual([]);
    m.caller.mockResolvedValue({ userId: "u1", identity: { memberId: ME, isSudo: false } });
    m.features.mockResolvedValue([]);
    expect(await searchDmCandidates("ada")).toEqual([]);
  });

  it("returns nothing when no one matches", async () => {
    expect(await searchDmCandidates("zzz")).toEqual([]);
  });
});
