import { describe, it, expect, vi, beforeEach } from "vitest";

const redirect = vi.fn((url: string): never => {
  throw Object.assign(new Error(`NEXT_REDIRECT: ${url}`), { url });
});
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));

const { tabHref, tabTitle, redirectLegacyTabParam } = await import("@/lib/tab-routes");

const IDS = ["overview", "attendance", "slack"] as const;

beforeEach(() => {
  redirect.mockClear();
});

describe("tabHref", () => {
  it("puts the first tab at the base path and the rest below it", () => {
    expect(tabHref("/admin/members/m1", "overview", "overview")).toBe("/admin/members/m1");
    expect(tabHref("/admin/members/m1", "slack", "overview")).toBe("/admin/members/m1/slack");
  });
});

describe("tabTitle", () => {
  it("puts the tab before the section, and adds nothing on the first tab", () => {
    expect(tabTitle({ section: "My Prickles" }, "Upcoming", true)).toBe("My Prickles");
    expect(tabTitle({ section: "My Prickles" }, "All Prickles", false)).toBe("All Prickles · My Prickles");
  });

  it("always orders record · tab · section, most specific first", () => {
    expect(tabTitle({ record: "Fern Quillsby" }, "Slack Activity", false)).toBe("Fern Quillsby · Slack Activity");
    expect(tabTitle({ record: "Fern Quillsby" }, "Overview", true)).toBe("Fern Quillsby");
    expect(tabTitle({ record: "Fern Quillsby", section: "Members" }, "Slack Activity", false)).toBe(
      "Fern Quillsby · Slack Activity · Members"
    );
  });
});

describe("redirectLegacyTabParam", () => {
  it("redirects ?tab=<id> to its path, keeping the other params", () => {
    expect(() =>
      redirectLegacyTabParam("/admin/members/m1", IDS, { tab: "slack", q: "x", multi: ["a", "b"] })
    ).toThrow();
    expect(redirect).toHaveBeenCalledWith("/admin/members/m1/slack?q=x&multi=a&multi=b");
  });

  it("redirects the first tab to the bare base path", () => {
    expect(() => redirectLegacyTabParam("/admin/members/m1", IDS, { tab: "overview" })).toThrow();
    expect(redirect).toHaveBeenCalledWith("/admin/members/m1");
  });

  it("does nothing without a tab, or with an unknown one", () => {
    redirectLegacyTabParam("/admin/members/m1", IDS, {});
    redirectLegacyTabParam("/admin/members/m1", IDS, { tab: "bogus" });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("lets the caller rewrite the target", () => {
    expect(() =>
      redirectLegacyTabParam("/x", IDS, { tab: "slack", old: "1" }, (t) => {
        t.tab = "attendance";
        t.params.delete("old");
      })
    ).toThrow();
    expect(redirect).toHaveBeenCalledWith("/x/attendance");
  });
});
