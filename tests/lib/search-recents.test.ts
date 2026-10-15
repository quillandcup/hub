// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { isTrackablePlace, readFlag, readPlaces, readSearches, removeSearch, savePlace, saveSearch, writeFlag } from "@/lib/search/recents";

describe("recents", () => {
  beforeEach(() => localStorage.clear());

  it("keeps the newest five searches without repeats, and removes one", () => {
    for (const q of ["a", "b", "c", "d", "e", "f", "c"]) saveSearch(q);
    expect(readSearches()).toEqual(["c", "f", "e", "d", "b"]);
    removeSearch("f");
    expect(readSearches()).toEqual(["c", "e", "d", "b"]);
  });

  it("keeps the newest places by address, ignoring ones with no title", () => {
    savePlace({ href: "/streaks", title: "Streaks" });
    savePlace({ href: "/members", title: "Members" });
    savePlace({ href: "/streaks", title: "Streaks (again)" });
    savePlace({ href: "/blank", title: "  " });
    expect(readPlaces()).toEqual([
      { href: "/streaks", title: "Streaks (again)" },
      { href: "/members", title: "Members" },
    ]);
  });

  it("survives junk in storage", () => {
    localStorage.setItem("hub:recent-places", "not json");
    localStorage.setItem("hub:recent-searches", JSON.stringify([1, "ok"]));
    expect(readPlaces()).toEqual([]);
    expect(readSearches()).toEqual(["ok"]);
  });

  it("reads flags as off unless stored on", () => {
    expect(readFlag("hub:search-history-on")).toBe(false);
    writeFlag("hub:search-history-on", true);
    expect(readFlag("hub:search-history-on")).toBe(true);
  });

  it("doesn't count the search or sign-in pages as places", () => {
    expect(isTrackablePlace("/search")).toBe(false);
    expect(isTrackablePlace("/admin/search")).toBe(false);
    expect(isTrackablePlace("/login")).toBe(false);
    expect(isTrackablePlace("/settings/profile")).toBe(true);
    expect(isTrackablePlace("/searching-tips")).toBe(true);
  });
});
