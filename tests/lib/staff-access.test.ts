import { describe, expect, it } from "vitest";
import { COMMUNITY_MANAGER_HOME, COMMUNITY_MANAGER_ROLE, isCommunityManagerPath, mayOpenAdminPath } from "@/lib/staff-access";
import { SITE_PAGES } from "@/lib/site-pages";

describe("isCommunityManagerPath", () => {
  it.each([
    "/admin",
    "/admin/at-risk",
    "/admin/stats",
    "/admin/calendar",
    "/admin/members",
    "/admin/members/mbr_AAAAAAAAAAA1",
    "/admin/members/mbr_AAAAAAAAAAA1/attendance",
    "/admin/members/mbr_AAAAAAAAAAA1/slack",
    "/admin/insights/slack-engagement",
    "/admin/insights/resubscriptions",
    "/admin/prickles/prkl_AAAAAAAAAAA1",
    "/admin/at-risk/",
  ])("opens %s", (path) => {
    expect(isCommunityManagerPath(path)).toBe(true);
  });

  it.each([
    "/admin/users",
    "/admin/activity",
    "/admin/analytics",
    "/admin/insights/prickles",
    "/admin/members/network",
    "/admin/members/network/anything",
    "/admin/members/mbr_AAAAAAAAAAA1/identity",
    "/admin/members/mbr_AAAAAAAAAAA1/activity",
    "/admin/prickles",
    "/admin/data/import",
    "/admin/work-queue",
    "/administrivia",
    "/dashboard",
  ])("does not open %s", (path) => {
    expect(isCommunityManagerPath(path)).toBe(false);
  });
});

describe("mayOpenAdminPath", () => {
  it("lets an admin open anything", () => {
    expect(mayOpenAdminPath("admin", "/admin/users")).toBe(true);
  });

  it("lets a community manager open only their pages", () => {
    expect(mayOpenAdminPath(COMMUNITY_MANAGER_ROLE, COMMUNITY_MANAGER_HOME)).toBe(true);
    expect(mayOpenAdminPath(COMMUNITY_MANAGER_ROLE, "/admin/users")).toBe(false);
  });

  it.each(["member", "assistant", null, undefined, ""])("refuses the role %s", (role) => {
    expect(mayOpenAdminPath(role, "/admin/at-risk")).toBe(false);
  });
});

describe("the sidebar and the allowlist agree", () => {
  it("flags exactly the registry pages the allowlist opens (the dashboard only redirects)", () => {
    const flagged = SITE_PAGES.filter((p) => p.communityManager).map((p) => p.href);
    expect(flagged.length).toBeGreaterThan(0);
    for (const href of flagged) expect(isCommunityManagerPath(href), href).toBe(true);
    const openAdminPages = SITE_PAGES.filter((p) => p.audience === "admin" && p.href !== "/admin" && isCommunityManagerPath(p.href)).map((p) => p.href);
    expect(openAdminPages.sort()).toEqual([...flagged].sort());
  });

  it("starts a community manager on a page they may open", () => {
    expect(isCommunityManagerPath(COMMUNITY_MANAGER_HOME)).toBe(true);
  });
});
