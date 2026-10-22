import { describe, expect, it } from "vitest";
import { ORG_TIMEZONE } from "@/lib/config";
import { orgTimeNote, withOrgTime } from "@/lib/org-time";

describe("org time note", () => {
  const summer = "2026-10-16T11:00:00Z"; // 7:00 AM EDT
  const winter = "2026-12-16T12:00:00Z"; // 7:00 AM EST

  it("is empty for a viewer in the org zone", () => {
    expect(orgTimeNote(summer, ORG_TIMEZONE)).toBe("");
    expect(withOrgTime("7:00 AM", summer, ORG_TIMEZONE)).toBe("7:00 AM");
  });

  it("shows the Eastern time beside another zone's", () => {
    expect(withOrgTime("4:00 AM", summer, "America/Los_Angeles")).toBe("4:00 AM (7:00 AM ET)");
    expect(withOrgTime("4:00 AM", winter, "America/Los_Angeles")).toBe("4:00 AM (7:00 AM ET)");
  });

  it("adds the weekday when Eastern is on a different day", () => {
    // 11:30 PM Thursday in Los Angeles is 2:30 AM Friday Eastern.
    expect(orgTimeNote("2026-10-16T06:30:00Z", "America/Los_Angeles")).toBe("Fri 2:30 AM ET");
  });

  it("covers the daylight saving gap between zones", () => {
    // Europe has changed clocks but the US has not: 1 hour apart becomes 5.
    expect(orgTimeNote("2026-10-27T12:00:00Z", "Europe/London")).toBe("8:00 AM ET");
  });
});
