import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFakeSupabase, resetServerPageMocks, signInAs, MEMBER_USER, MEMBER_IDENTITY } from "@/tests/helpers/server-page";

vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
vi.mock("@/lib/member-slack-links", () => ({ getSlackDmLinksForMembers: async () => new Map() }));

import { getMemberHoverCard } from "@/app/actions/member-hover-card";

beforeEach(() => {
  resetServerPageMocks();
});

describe("getMemberHoverCard", () => {
  it("refuses a signed-out caller", async () => {
    signInAs(null);
    expect(await getMemberHoverCard("mbr_ada")).toEqual({ error: "Sign in to see profiles." });
  });

  it("returns the card for a signed-in member", async () => {
    signInAs(MEMBER_USER, MEMBER_IDENTITY);
    useFakeSupabase({ member_directory: { data: [{ id: "mbr_ada", name: "Ada Example", display_name: null }] } });
    const result = await getMemberHoverCard("mbr_ada");
    expect(result).toMatchObject({ card: { id: "mbr_ada", name: "Ada Example" } });
  });

  it("says so when the member isn't visible, and rejects an empty id", async () => {
    signInAs(MEMBER_USER, MEMBER_IDENTITY);
    useFakeSupabase({ member_directory: { data: [] } });
    expect(await getMemberHoverCard("mbr_nobody")).toEqual({ error: "This member isn't available." });
    expect(await getMemberHoverCard("")).toEqual({ error: "Couldn't load this profile." });
  });

  it("reports a failure instead of throwing", async () => {
    signInAs(MEMBER_USER, MEMBER_IDENTITY);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    useFakeSupabase({ member_directory: () => { throw new Error("boom"); } });
    expect(await getMemberHoverCard("mbr_ada")).toEqual({ error: "Couldn't load this profile." });
    spy.mockRestore();
  });
});
