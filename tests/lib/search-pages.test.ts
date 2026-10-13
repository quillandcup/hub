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

describe("tab pages", () => {
  const found = (word: string) => matchPages([word], member).map((p) => `${p.title} / ${p.section} / ${p.href}`);

  it("lists a tabbed page's first tab under the page, like the other tabs", () => {
    expect(found("upcoming")).toEqual(["Upcoming / My Prickles / /my-prickles"]);
    expect(found("projects")).toEqual(["Projects / My Writing / /projects"]);
    expect(found("account")[0]).toBe("Account / Settings / /settings");
  });
});

describe("settings tab keywords", () => {
  const settingsFor = (query: string[]) => matchPages(query, member).filter((p) => p.section === "Settings").map((p) => p.title);

  it("finds the tab whose form has the field", () => {
    expect(settingsFor(["instagram"])).toEqual(["Profile"]);
    expect(settingsFor(["twitter"])).toEqual(["Profile"]);
    expect(settingsFor(["pen", "name"])).toEqual(["Identity"]);
    expect(settingsFor(["email"])).toEqual(expect.arrayContaining(["Account", "Identity", "Notifications"]));
  });
});

describe("settings sections in search", () => {
  const rows = (query: string[], opts = member) => matchPages(query, opts).map((p) => `${p.title} / ${p.section} / ${p.href}`);

  it("finds a section under its tab, linked to its anchor", () => {
    expect(rows(["pen", "name"])).toContain("Pen names and Zoom/Slack names / Settings · Identity / /settings/identity#identity-pen-names");
    expect(rows(["instagram"])).toContain("Instagram / Settings · Profile / /settings/profile#profile-instagram");
  });

  it("still finds the tab itself by its keywords", () => {
    expect(rows(["instagram"])).toContain("Profile / Settings / /settings/profile");
  });

  it("finds notification kinds one by one", () => {
    expect(rows(["check-ins"]).some((r) => r.includes("/settings/notifications#notification-prickle_checkin"))).toBe(true);
  });

  it("shows the Previews tab only to admins", () => {
    expect(rows(["previews"])).toEqual([]);
    expect(rows(["previews"], { isActingAsAdmin: true, features: [] })).toContain("Previews / Settings / /settings/previews");
  });
});
