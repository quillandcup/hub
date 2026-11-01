import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

// getSearcher decides what a search may show: staff results only for an admin who isn't acting as a member.
// The role comes from the profile repository (in memory here).

const getCurrentUser = vi.fn();
vi.mock("@/lib/auth", () => ({ getCurrentUser: () => getCurrentUser() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ client: true }) }));
const getEffectiveIdentity = vi.fn();
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: (...args: unknown[]) => getEffectiveIdentity(...args) }));
vi.mock("@/lib/features.server", () => ({
  getUserFeaturePreviews: vi.fn(async () => []),
  effectiveMemberHasFeature: vi.fn(async () => false),
}));
vi.mock("@/lib/chat/load", () => ({ loadChatChannels: vi.fn(async () => []) }));
let dataset = new InMemoryDataset();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => createInMemoryRepos(dataset),
}));

import { getSearcher } from "@/lib/search/context";

const USER = { id: "user-1", email: "u1@example.test" };
const IDENTITY = { memberId: "mbr_AAAAAAAAAAA1", memberName: "Ada Example", memberEmail: "ada@example.test" };

const withRole = (role: string) => {
  dataset = new InMemoryDataset({ userProfiles: [{ id: USER.id, email: USER.email, role }] });
};

beforeEach(() => {
  getCurrentUser.mockResolvedValue(USER);
  getEffectiveIdentity.mockResolvedValue({ ...IDENTITY, isSudo: false });
  withRole("member");
});

describe("getSearcher", () => {
  it("is null when nobody is signed in", async () => {
    getCurrentUser.mockResolvedValue(null);
    expect(await getSearcher()).toBeNull();
  });

  it("treats an admin as acting as staff, and a member as not", async () => {
    withRole("admin");
    expect(await getSearcher()).toMatchObject({ isAdmin: true, isSudo: false, ctx: { isActingAsAdmin: true, viewerMemberId: IDENTITY.memberId } });

    withRole("member");
    expect(await getSearcher()).toMatchObject({ isAdmin: false, ctx: { isActingAsAdmin: false } });
  });

  it("stops treating an admin as staff while they browse as a member", async () => {
    withRole("admin");
    getEffectiveIdentity.mockResolvedValue({ ...IDENTITY, isSudo: true });

    expect(await getSearcher()).toMatchObject({ isAdmin: true, isSudo: true, ctx: { isActingAsAdmin: false } });
  });

  it("leaves chat out when the chat feature is off", async () => {
    expect(await getSearcher()).toMatchObject({ skip: ["chat", "channels"] });
  });
});
