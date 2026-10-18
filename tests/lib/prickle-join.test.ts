import { describe, it, expect } from "vitest";
import { joinAt, joinDescription, type PrickleJoinSetting } from "@/lib/prickle-join";

const setting = (id: string, effectiveFrom: string, passcode: string): PrickleJoinSetting => ({
  id,
  url: `https://zoom.us/j/${id}`,
  passcode,
  effectiveFrom,
  createdAt: effectiveFrom,
});

// Newest first, as loadPrickleJoinSettings returns them.
const history = [setting("2", "2026-11-01T00:00:00Z", "new"), setting("1", "2026-10-01T00:00:00Z", "old")];

describe("joinAt", () => {
  it("uses the setting in effect at the prickle's start", () => {
    expect(joinAt(history, "2026-11-02T12:00:00Z")?.passcode).toBe("new");
    expect(joinAt(history, "2026-10-15T12:00:00Z")?.passcode).toBe("old");
  });

  it("is null before the first setting or with none", () => {
    expect(joinAt(history, "2026-09-01T00:00:00Z")).toBeNull();
    expect(joinAt([], new Date())).toBeNull();
  });
});

describe("joinDescription", () => {
  it("lists the link and passcode", () => {
    expect(joinDescription({ url: "https://zoom.us/j/1", passcode: "x" })).toBe("Join on Zoom: https://zoom.us/j/1\nPasscode: x");
    expect(joinDescription({ url: "https://zoom.us/j/1", passcode: null })).toBe("Join on Zoom: https://zoom.us/j/1");
    expect(joinDescription(null)).toBe("");
  });
});

import { effectiveFromForDate, isFutureDate } from "@/lib/prickle-join";

describe("scheduling a change", () => {
  it("starts at the day's midnight in the org timezone, DST included", () => {
    expect(effectiveFromForDate("2026-11-02", "America/New_York").toISOString()).toBe("2026-11-02T05:00:00.000Z");
    expect(effectiveFromForDate("2026-10-02", "America/New_York").toISOString()).toBe("2026-10-02T04:00:00.000Z");
  });

  it("puts a midnight-crossing prickle on the day it starts", () => {
    const h = [setting("2", effectiveFromForDate("2026-11-02", "America/New_York").toISOString(), "new"), setting("1", "2026-10-01T00:00:00Z", "old")];
    // 11:30 PM ET on Nov 1 is still the old day, 12:30 AM ET on Nov 2 is the new one.
    expect(joinAt(h, "2026-11-02T04:30:00Z")?.passcode).toBe("old");
    expect(joinAt(h, "2026-11-02T05:30:00Z")?.passcode).toBe("new");
  });

  it("only accepts days after today in the org timezone", () => {
    const now = new Date("2026-11-02T03:00:00Z"); // still Nov 1 evening in New York
    expect(isFutureDate("2026-11-01", now, "America/New_York")).toBe(false);
    expect(isFutureDate("2026-11-02", now, "America/New_York")).toBe(true);
    expect(isFutureDate("nope", now, "America/New_York")).toBe(false);
  });
});

import { firstOfNextMonth, tomorrowIn } from "@/lib/prickle-join";

describe("start day defaults", () => {
  it("uses the org timezone's calendar, not UTC", () => {
    const lateOct31Eastern = new Date("2026-11-01T02:00:00Z"); // 10 PM Oct 31 in New York
    expect(tomorrowIn(lateOct31Eastern, "America/New_York")).toBe("2026-11-01");
    expect(firstOfNextMonth(lateOct31Eastern, "America/New_York")).toBe("2026-11-01");
    expect(firstOfNextMonth(new Date("2026-12-15T12:00:00Z"), "America/New_York")).toBe("2027-01-01");
  });
});
