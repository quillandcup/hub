import { describe, it, expect } from "vitest";
import type { FeatureKey } from "@/lib/features";
import { matchPages } from "@/lib/search/pages";
import { parseUniversal } from "@/lib/search/syntax";
import { universalSearch } from "@/lib/search/universal";

const member = { isActingAsAdmin: false, features: [] as FeatureKey[] };
const titles = (words: string[], opts = member) => matchPages(words, opts).map((p) => p.title);

describe("matchPages", () => {
  it("finds a page by title, section or keyword", () => {
    expect(titles(["streaks"])).toContain("Streaks");
    expect(titles(["settings"])).toContain("Profile");
    expect(titles(["logout"])).toContain("Account");
  });

  it("requires every word and ranks title matches first", () => {
    expect(matchPages(["notification", "settings"], member).map((p) => p.href)).toEqual(["/settings/notifications"]);
    expect(matchPages(["notifications"], member).map((p) => p.href)).toContain("/notifications");
  });

  it("hides admin pages from members and pages whose feature is off", () => {
    expect(titles(["work queue"])).toEqual([]);
    expect(titles(["health"], { isActingAsAdmin: true, features: [] })).toContain("Health Check");
    expect(titles(["health"])).toEqual([]);
    expect(titles(["chat"])).not.toContain("Chat");
    expect(titles(["chat"], { isActingAsAdmin: false, features: ["chat"] })).toContain("Chat");
  });
});

describe("universalSearch pages kind", () => {
  const ctx = { supabase: {} as never, viewerMemberId: null, isActingAsAdmin: false, chatChannels: [], features: [] };

  it("returns page hits without touching the database", async () => {
    const [group] = await universalSearch(ctx, parseUniversal("in:pages streaks"));
    expect(group.kind).toBe("pages");
    expect(group.hits[0]).toMatchObject({ title: "Streaks", href: "/streaks" });
  });

  it("returns nothing when a filter pages can't honor is set", async () => {
    const [group] = await universalSearch(ctx, parseUniversal("in:pages streaks after:2026"));
    expect(group.hits).toEqual([]);
  });
});
