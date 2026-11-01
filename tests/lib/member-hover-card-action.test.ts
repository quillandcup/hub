import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetServerPageMocks, signInAs, MEMBER_USER, MEMBER_IDENTITY } from "@/tests/helpers/server-page";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos, type Repos } from "@/lib/data/repos";

vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/member-slack-links", () => ({ getSlackDmLinksForMembers: async () => new Map() }));

let repos: Repos;
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

import { getMemberHoverCard } from "@/app/actions/member-hover-card";

const ADA = "mbr_AAAAAAAAAAA1";

beforeEach(() => {
  resetServerPageMocks();
  repos = createInMemoryRepos(new InMemoryDataset({ members: [{ id: ADA, name: "Ada Example" }] }));
});

describe("getMemberHoverCard", () => {
  it("refuses a signed-out caller", async () => {
    signInAs(null);
    expect(await getMemberHoverCard(ADA)).toEqual({ error: "Sign in to see profiles." });
  });

  it("returns the card for a signed-in member", async () => {
    signInAs(MEMBER_USER, MEMBER_IDENTITY);
    const result = await getMemberHoverCard(ADA);
    expect(result).toMatchObject({ card: { id: ADA, name: "Ada Example" } });
  });

  it("says so when the member isn't visible, and rejects an empty id", async () => {
    signInAs(MEMBER_USER, MEMBER_IDENTITY);
    expect(await getMemberHoverCard("mbr_BBBBBBBBBBB2")).toEqual({ error: "This member isn't available." });
    expect(await getMemberHoverCard("")).toEqual({ error: "Couldn't load this profile." });
  });

  it("reports a failure instead of throwing", async () => {
    signInAs(MEMBER_USER, MEMBER_IDENTITY);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    repos.directory.byId = async () => {
      throw new Error("boom");
    };
    expect(await getMemberHoverCard(ADA)).toEqual({ error: "Couldn't load this profile." });
    spy.mockRestore();
  });
});
