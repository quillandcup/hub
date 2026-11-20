import { describe, expect, it } from "vitest";
import {
  VISIBILITIES,
  isShownToMembers,
  isVisibility,
  lessVisible,
  nextVisibility,
  reconcileVisibility,
  visibilityOf,
  visibilityRank,
} from "@/lib/writing-visibility";

const PROJECT_DEFAULTS = { visibility: "community", show_on_profile: true } as const;
const GOAL_DEFAULTS = { visibility: "private", show_on_profile: false } as const;

describe("writing visibility levels", () => {
  it("has three levels, ordered from private to public", () => {
    expect(VISIBILITIES).toEqual(["private", "community", "public"]);
    expect(VISIBILITIES.map(visibilityRank)).toEqual([0, 1, 2]);
  });

  it("accepts only the three levels", () => {
    expect(["private", "community", "public"].every(isVisibility)).toBe(true);
    for (const bad of ["everyone", "", "PUBLIC", true, false, null, undefined, 1]) expect(isVisibility(bad)).toBe(false);
  });

  it("cycles private, community, public, then back to private", () => {
    expect(nextVisibility("private")).toBe("community");
    expect(nextVisibility("community")).toBe("public");
    expect(nextVisibility("public")).toBe("private");
  });

  it("shows to members from community up, and picks the more private of two levels", () => {
    expect(VISIBILITIES.map(isShownToMembers)).toEqual([false, true, true]);
    expect(lessVisible("public", "community")).toBe("community");
    expect(lessVisible("private", "public")).toBe("private");
    expect(lessVisible("community", "community")).toBe("community");
  });

  it("reads a row that has only the old flag as community or private", () => {
    expect(visibilityOf({ show_on_profile: true })).toBe("community");
    expect(visibilityOf({ show_on_profile: false })).toBe("private");
    expect(visibilityOf({ show_on_profile: false, visibility: "public" })).toBe("public");
  });
});

describe("reconcileVisibility (what the database triggers do)", () => {
  it("lets a written level win and sets the flag from it", () => {
    expect(reconcileVisibility({ visibility: "private", show_on_profile: false }, { visibility: "public" }, GOAL_DEFAULTS)).toEqual({ visibility: "public", show_on_profile: true });
    expect(reconcileVisibility({ visibility: "public", show_on_profile: true }, { visibility: "private", show_on_profile: true }, GOAL_DEFAULTS)).toEqual({ visibility: "private", show_on_profile: false });
  });

  it("moves private <-> community when only the flag is written, and keeps a public level when the flag stays on", () => {
    const before = { visibility: "private", show_on_profile: false } as const;
    expect(reconcileVisibility(before, { show_on_profile: true }, GOAL_DEFAULTS)).toEqual({ visibility: "community", show_on_profile: true });
    expect(reconcileVisibility({ visibility: "public", show_on_profile: true }, { show_on_profile: true }, GOAL_DEFAULTS)).toEqual({ visibility: "public", show_on_profile: true });
    expect(reconcileVisibility({ visibility: "public", show_on_profile: true }, { show_on_profile: false }, GOAL_DEFAULTS)).toEqual({ visibility: "private", show_on_profile: false });
  });

  it("changes nothing when nothing about visibility is written", () => {
    const before = { visibility: "public", show_on_profile: true } as const;
    expect(reconcileVisibility(before, {}, GOAL_DEFAULTS)).toBe(before);
  });

  it("follows whichever of the two a new row names", () => {
    expect(reconcileVisibility(null, {}, PROJECT_DEFAULTS)).toEqual({ visibility: "community", show_on_profile: true });
    expect(reconcileVisibility(null, { show_on_profile: false }, PROJECT_DEFAULTS)).toEqual({ visibility: "private", show_on_profile: false });
    expect(reconcileVisibility(null, { visibility: "public" }, PROJECT_DEFAULTS)).toEqual({ visibility: "public", show_on_profile: true });
    expect(reconcileVisibility(null, {}, GOAL_DEFAULTS)).toEqual({ visibility: "private", show_on_profile: false });
    expect(reconcileVisibility(null, { show_on_profile: true }, GOAL_DEFAULTS)).toEqual({ visibility: "community", show_on_profile: true });
    expect(reconcileVisibility(null, { visibility: "private" }, PROJECT_DEFAULTS)).toEqual({ visibility: "private", show_on_profile: false });
  });
});
