import { describe, expect, it } from "vitest";
import { careFirstMessageInstant, careStartInstant, clampToChain, daysBetween, isRealDay, periodEndsOn, shiftedPeriodEnd, startChangeRefusal, startDayProblem, startOfOrgDay } from "@/lib/care";

// Eastern time: UTC-5 until the second Sunday of March (2026-03-08) and again from the first Sunday of November (2026-11-01),
// UTC-4 in between. Every "now" below is an exact instant, so nothing depends on the machine's zone.
const EASTERN_MIDNIGHT_BEFORE = new Date("2026-03-12T03:30:00.000Z"); // 23:30 on Mar 11 in Eastern (still Mar 11, though already Mar 12 in UTC)
const EASTERN_MIDNIGHT_AFTER = new Date("2026-03-12T04:30:00.000Z"); // 00:30 on Mar 12 in Eastern

describe("isRealDay", () => {
  it("takes a real calendar day and nothing else", () => {
    expect(isRealDay("2026-03-11")).toBe(true);
    expect(isRealDay("2028-02-29")).toBe(true);
    for (const bad of ["2026-02-30", "2026-13-01", "2026-3-1", "yesterday", "", null, undefined, 20260311]) expect(isRealDay(bad)).toBe(false);
  });
});

describe("startDayProblem", () => {
  it("refuses a day that is not real, and a day after today in Eastern time", () => {
    expect(startDayProblem("2026-02-30", EASTERN_MIDNIGHT_AFTER)).toBe("invalid");
    expect(startDayProblem(undefined, EASTERN_MIDNIGHT_AFTER)).toBe("invalid");
    expect(startDayProblem("2026-03-13", EASTERN_MIDNIGHT_AFTER)).toBe("future");
  });

  it("goes by the Eastern day on both sides of Eastern midnight", () => {
    // 23:30 Eastern on Mar 11: Mar 12 has not begun, even though UTC is already on it.
    expect(startDayProblem("2026-03-11", EASTERN_MIDNIGHT_BEFORE)).toBeNull();
    expect(startDayProblem("2026-03-12", EASTERN_MIDNIGHT_BEFORE)).toBe("future");
    // 00:30 Eastern on Mar 12: now it has.
    expect(startDayProblem("2026-03-12", EASTERN_MIDNIGHT_AFTER)).toBeNull();
    expect(startDayProblem("2026-03-13", EASTERN_MIDNIGHT_AFTER)).toBe("future");
  });
});

describe("careStartInstant", () => {
  it("is the current moment for today, whichever side of Eastern midnight", () => {
    expect(careStartInstant("2026-03-11", EASTERN_MIDNIGHT_BEFORE)).toEqual(EASTERN_MIDNIGHT_BEFORE);
    expect(careStartInstant("2026-03-12", EASTERN_MIDNIGHT_AFTER)).toEqual(EASTERN_MIDNIGHT_AFTER);
  });

  it("is noon Eastern of an earlier day", () => {
    expect(careStartInstant("2026-03-11", EASTERN_MIDNIGHT_AFTER).toISOString()).toBe("2026-03-11T16:00:00.000Z"); // noon EDT
    expect(careStartInstant("2026-03-10", EASTERN_MIDNIGHT_BEFORE).toISOString()).toBe("2026-03-10T16:00:00.000Z");
  });

  it("is still noon Eastern on the day the clocks go forward, and the day before and after", () => {
    const now = new Date("2026-03-20T15:00:00.000Z");
    expect(careStartInstant("2026-03-07", now).toISOString()).toBe("2026-03-07T17:00:00.000Z"); // noon EST
    expect(careStartInstant("2026-03-08", now).toISOString()).toBe("2026-03-08T16:00:00.000Z"); // noon EDT (23-hour day)
    expect(careStartInstant("2026-03-09", now).toISOString()).toBe("2026-03-09T16:00:00.000Z");
  });

  it("is still noon Eastern on the day the clocks go back, and the day before and after", () => {
    const now = new Date("2026-11-10T15:00:00.000Z");
    expect(careStartInstant("2026-10-31", now).toISOString()).toBe("2026-10-31T16:00:00.000Z"); // noon EDT
    expect(careStartInstant("2026-11-01", now).toISOString()).toBe("2026-11-01T17:00:00.000Z"); // noon EST (25-hour day)
    expect(careStartInstant("2026-11-02", now).toISOString()).toBe("2026-11-02T17:00:00.000Z");
  });

  it("puts the period's last day a whole number of calendar days on from the chosen day, across a clock change", () => {
    const now = new Date("2026-04-20T15:00:00.000Z");
    expect(periodEndsOn(careStartInstant("2026-03-07", now), 30)).toBe("2026-04-06");
    expect(periodEndsOn(careStartInstant("2026-03-08", now), 30)).toBe("2026-04-07");
    expect(periodEndsOn(careStartInstant("2026-03-09", now), 30)).toBe("2026-04-08");
  });
});

describe("daysBetween", () => {
  it("counts calendar days, not hours, across both clock changes", () => {
    expect(daysBetween("2026-03-01", "2026-03-31")).toBe(30);
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
    expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2);
    expect(daysBetween("2026-03-05", "2026-03-01")).toBe(-4);
  });
});

describe("shiftedPeriodEnd", () => {
  it("keeps the length the period had, from the new day", () => {
    const opened = { opened_at: "2026-03-01T15:00:00.000Z", period_ends_on: "2026-03-31" };
    expect(shiftedPeriodEnd(opened, new Date("2026-02-20T17:00:00.000Z"))).toBe("2026-03-22");
    // Later, across the day the clocks go forward.
    expect(shiftedPeriodEnd(opened, new Date("2026-03-08T16:00:00.000Z"))).toBe("2026-04-07");
  });

  it("keeps a length that is not today's setting", () => {
    expect(shiftedPeriodEnd({ opened_at: "2026-03-01T15:00:00.000Z", period_ends_on: "2026-04-15" }, new Date("2026-02-01T17:00:00.000Z"))).toBe("2026-03-18");
  });

  it("reads the day it opened on in Eastern time, not UTC", () => {
    // 22:00 Eastern on Mar 1 is already Mar 2 in UTC: the period is still 30 days from Mar 1.
    const evening = { opened_at: "2026-03-02T03:00:00.000Z", period_ends_on: "2026-03-31" };
    expect(shiftedPeriodEnd(evening, new Date("2026-02-20T17:00:00.000Z"))).toBe("2026-03-22");
  });

  it("never ends before it began, even for a stored end before the start", () => {
    expect(shiftedPeriodEnd({ opened_at: "2026-03-10T15:00:00.000Z", period_ends_on: "2026-03-05" }, new Date("2026-03-02T17:00:00.000Z"))).toBe("2026-03-02");
  });
});

describe("startChangeRefusal", () => {
  const around = { previousOpenedAt: "2026-03-01T15:00:00.000Z", renewalOpenedAt: "2026-04-02T12:00:00.000Z", closedAt: "2026-04-02T12:00:00.000Z" };

  it("allows a start between the period it continues and the one that continued it, and equal to either", () => {
    expect(startChangeRefusal(new Date("2026-03-15T17:00:00.000Z"), around)).toBeNull();
    expect(startChangeRefusal(new Date(around.previousOpenedAt), around)).toBeNull();
    expect(startChangeRefusal(new Date(around.renewalOpenedAt), around)).toBeNull();
  });

  it("refuses before the one it continues, with the instant that stops it", () => {
    expect(startChangeRefusal(new Date("2026-02-28T17:00:00.000Z"), around)).toEqual({ reason: "before_previous", limit: around.previousOpenedAt });
  });

  it("refuses after its renewal, and after it was closed", () => {
    expect(startChangeRefusal(new Date("2026-04-03T17:00:00.000Z"), around)).toEqual({ reason: "after_renewal", limit: around.renewalOpenedAt });
    expect(startChangeRefusal(new Date("2026-04-03T17:00:00.000Z"), { ...around, renewalOpenedAt: null })).toEqual({ reason: "after_closed", limit: around.closedAt });
  });

  it("has nothing to check for one that continues nothing, was not renewed and is open", () => {
    expect(startChangeRefusal(new Date("2020-01-01T00:00:00.000Z"), { previousOpenedAt: null, renewalOpenedAt: null, closedAt: null })).toBeNull();
  });
});

describe("clampToChain", () => {
  const around = { previousOpenedAt: "2026-03-01T15:00:00.000Z", renewalOpenedAt: "2026-04-02T14:00:00.000Z", closedAt: "2026-04-10T14:00:00.000Z" };

  it("moves a start on the same Eastern day as the one before to that moment, when noon would be earlier", () => {
    // 2026-03-01 15:00Z is 10:00 Eastern; a start at 07:00 Eastern the same day goes to 10:00.
    expect(clampToChain(new Date("2026-03-01T12:00:00.000Z"), around).toISOString()).toBe("2026-03-01T15:00:00.000Z");
  });

  it("moves a start on the same Eastern day as its renewal, or its close, to that moment, when noon would be later", () => {
    expect(clampToChain(new Date("2026-04-02T16:00:00.000Z"), around).toISOString()).toBe("2026-04-02T14:00:00.000Z");
    expect(clampToChain(new Date("2026-04-10T16:00:00.000Z"), { ...around, renewalOpenedAt: null }).toISOString()).toBe("2026-04-10T14:00:00.000Z");
  });

  it("leaves a start on another day, or on the right side of the boundary, as it is", () => {
    for (const iso of ["2026-02-28T17:00:00.000Z", "2026-03-01T16:00:00.000Z", "2026-03-15T16:00:00.000Z", "2026-04-02T13:00:00.000Z", "2026-04-03T16:00:00.000Z"]) {
      expect(clampToChain(new Date(iso), around).toISOString()).toBe(iso);
    }
    expect(clampToChain(new Date("2026-01-01T17:00:00.000Z"), { previousOpenedAt: null, renewalOpenedAt: null, closedAt: null }).toISOString()).toBe("2026-01-01T17:00:00.000Z");
  });

  it("a day away is a day away: it is not moved onto the boundary, so it is still refused", () => {
    const next = clampToChain(new Date("2026-04-03T16:00:00.000Z"), around);
    expect(startChangeRefusal(next, around)).toMatchObject({ reason: "after_renewal" });
  });
});

describe("startOfOrgDay and careFirstMessageInstant", () => {
  it("start at Eastern midnight, on the clock-change days too", () => {
    expect(startOfOrgDay("2026-03-07").toISOString()).toBe("2026-03-07T05:00:00.000Z");
    expect(startOfOrgDay("2026-03-08").toISOString()).toBe("2026-03-08T05:00:00.000Z"); // midnight is still EST; the change is at 2 a.m.
    expect(startOfOrgDay("2026-03-09").toISOString()).toBe("2026-03-09T04:00:00.000Z");
    expect(startOfOrgDay("2026-11-01").toISOString()).toBe("2026-11-01T04:00:00.000Z"); // still EDT at midnight
    expect(startOfOrgDay("2026-11-02").toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });

  it("puts the first message now for today and at the start of the day for an earlier one", () => {
    expect(careFirstMessageInstant("2026-03-11", EASTERN_MIDNIGHT_BEFORE)).toEqual(EASTERN_MIDNIGHT_BEFORE);
    expect(careFirstMessageInstant("2026-03-12", EASTERN_MIDNIGHT_AFTER)).toEqual(EASTERN_MIDNIGHT_AFTER);
    expect(careFirstMessageInstant("2026-03-11", EASTERN_MIDNIGHT_AFTER).toISOString()).toBe("2026-03-11T04:00:00.000Z");
    expect(careFirstMessageInstant("2026-03-08", new Date("2026-03-20T15:00:00.000Z")).toISOString()).toBe("2026-03-08T05:00:00.000Z");
  });
});
