import { describe, it, expect } from "vitest";
import { PROFILE_ITEMS, WEB_ITEMS, defaultProfileVisibilities, isLevelAllowed, isProfileItem, levelsFor, shownOnTheWeb } from "@/lib/profile-visibility";
import { nextVisibility } from "@/lib/writing-visibility";

describe("profile item levels", () => {
  it("starts every item at community, which is what each was before levels existed", () => {
    expect(Object.values(defaultProfileVisibilities()).every((level) => level === "community")).toBe(true);
    expect(Object.keys(defaultProfileVisibilities()).sort()).toEqual([...PROFILE_ITEMS].sort());
  });

  it("offers the globe only on what the writer page shows, and only where pages on the web are open", () => {
    for (const item of WEB_ITEMS) {
      expect(levelsFor(item, { webPageAvailable: true })).toEqual(["private", "community", "public"]);
      expect(levelsFor(item, { webPageAvailable: false })).toEqual(["private", "community"]);
    }
    expect(levelsFor("ask_me_about", { webPageAvailable: true })).toEqual(["private", "community"]);
  });

  it("accepts a level for an item only when the item can have it", () => {
    expect(isLevelAllowed("bio", "public")).toBe(true);
    expect(isLevelAllowed("ask_me_about", "public")).toBe(false);
    expect(isLevelAllowed("ask_me_about", "private")).toBe(true);
    expect(isLevelAllowed("bio", "everyone")).toBe(false);
    expect(isLevelAllowed("bio", 3)).toBe(false);
    expect(isProfileItem("x")).toBe(true);
    expect(isProfileItem("email")).toBe(false);
  });

  it("shows an item on the web only when the page is on, the flag is on and the level is the globe", () => {
    for (const on of [true, false]) {
      for (const flagOn of [true, false]) {
        for (const level of ["private", "community", "public"] as const) {
          expect(shownOnTheWeb(level, { on, flagOn }), `${level} on=${on} flag=${flagOn}`).toBe(on && flagOn && level === "public");
        }
      }
    }
  });
});

describe("nextVisibility with a list of levels", () => {
  it("cycles only the given levels, in order, and moves from a level outside them to the first", () => {
    const noGlobe = ["private", "community"] as const;
    expect(nextVisibility("private", noGlobe)).toBe("community");
    expect(nextVisibility("community", noGlobe)).toBe("private");
    expect(nextVisibility("public", noGlobe)).toBe("private");
  });

  it("keeps the three-level cycle by default", () => {
    expect(nextVisibility("private")).toBe("community");
    expect(nextVisibility("community")).toBe("public");
    expect(nextVisibility("public")).toBe("private");
  });
});
