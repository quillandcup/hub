import { describe, expect, it } from "vitest";
import { secondaryTimeNote, withSecondaryTime } from "@/lib/secondary-time";

const NY = "America/New_York";

describe("secondary time note", () => {
  const summer = "2026-10-16T11:00:00Z"; // 7:00 AM EDT
  const winter = "2026-12-16T12:00:00Z"; // 7:00 AM EST

  it("is empty without a secondary zone", () => {
    expect(secondaryTimeNote(summer, "America/Los_Angeles", null)).toBe("");
    expect(withSecondaryTime("4:00 AM", summer, "America/Los_Angeles", null)).toBe("4:00 AM");
  });

  it("is empty when the secondary zone shows the same wall clock", () => {
    expect(withSecondaryTime("7:00 AM", summer, NY, NY)).toBe("7:00 AM");
  });

  it("shows the secondary time beside the viewer's, in summer and winter", () => {
    expect(withSecondaryTime("4:00 AM", summer, "America/Los_Angeles", NY)).toBe("4:00 AM (7:00 AM ET)");
    expect(withSecondaryTime("4:00 AM", winter, "America/Los_Angeles", NY)).toBe("4:00 AM (7:00 AM ET)");
  });

  it("adds the weekday when the secondary zone is on a different day", () => {
    expect(secondaryTimeNote("2026-10-16T06:30:00Z", "America/Los_Angeles", NY)).toBe("Fri 2:30 AM ET");
  });

  it("covers the daylight saving gap between zones", () => {
    expect(secondaryTimeNote("2026-10-27T12:00:00Z", "Europe/London", NY)).toBe("8:00 AM ET");
  });

  it("works for any secondary zone, not just Eastern", () => {
    expect(secondaryTimeNote(summer, NY, "Europe/London")).toMatch(/^12:00 PM /);
  });
});
