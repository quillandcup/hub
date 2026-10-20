import { describe, it, expect } from "vitest";
import { DEFAULT_AUDIENCE, audienceQuery, audienceRpcArgs, parseAudience } from "@/lib/analytics/audience";
import { exploreHref } from "@/lib/analytics/explore";

describe("parseAudience", () => {
  it("is the old behaviour by default: staff counted, sudo left out", () => {
    expect(parseAudience({})).toEqual(DEFAULT_AUDIENCE);
    expect(DEFAULT_AUDIENCE).toEqual({ ignoreStaff: false, ignoreSudo: true });
  });

  it("reads staff=hide and sudo=show, from a string or the first of several", () => {
    expect(parseAudience({ staff: "hide" })).toEqual({ ignoreStaff: true, ignoreSudo: true });
    expect(parseAudience({ sudo: "show" })).toEqual({ ignoreStaff: false, ignoreSudo: false });
    expect(parseAudience({ staff: ["hide", "x"], sudo: ["show"] })).toEqual({ ignoreStaff: true, ignoreSudo: false });
  });

  it.each(["", "yes", "true", "HIDE", "1"])("treats %j as no change", (value) => {
    expect(parseAudience({ staff: value, sudo: value })).toEqual(DEFAULT_AUDIENCE);
  });
});

describe("audienceQuery / audienceRpcArgs", () => {
  it("writes only what differs from the default, so shared links stay short", () => {
    expect(audienceQuery(DEFAULT_AUDIENCE)).toEqual({});
    expect(audienceQuery({ ignoreStaff: true, ignoreSudo: true })).toEqual({ staff: "hide" });
    expect(audienceQuery({ ignoreStaff: false, ignoreSudo: false })).toEqual({ sudo: "show" });
    expect(audienceQuery({ ignoreStaff: true, ignoreSudo: false })).toEqual({ staff: "hide", sudo: "show" });
  });

  it("round-trips through the address", () => {
    for (const audience of [
      { ignoreStaff: false, ignoreSudo: true },
      { ignoreStaff: true, ignoreSudo: true },
      { ignoreStaff: false, ignoreSudo: false },
      { ignoreStaff: true, ignoreSudo: false },
    ]) {
      expect(parseAudience(audienceQuery(audience))).toEqual(audience);
    }
  });

  it("maps to the SQL arguments", () => {
    expect(audienceRpcArgs({ ignoreStaff: true, ignoreSudo: false })).toEqual({ ignore_staff: true, ignore_sudo: false });
  });
});

describe("exploreHref with an audience", () => {
  it("keeps the filters in the explorer's address", () => {
    const href = exploreHref({ days: 30, steps: [], breakdown: null, audience: { ignoreStaff: true, ignoreSudo: false } });
    const params = new URL(href, "http://x").searchParams;
    expect(params.get("staff")).toBe("hide");
    expect(params.get("sudo")).toBe("show");
  });

  it("adds nothing for the default audience", () => {
    expect(exploreHref({ days: 30, steps: [], breakdown: null, audience: DEFAULT_AUDIENCE })).toBe("/admin/analytics/explore?days=30");
  });
});
