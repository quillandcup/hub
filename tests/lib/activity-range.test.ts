import { describe, expect, it } from "vitest";
import { ORG_TIMEZONE } from "@/lib/config";
import { allTimeStart, describeRange, formatRangeDay, parseDayRange, RANGE_FLOOR, RANGE_NOTICES, rangeInstants } from "@/lib/activity-range";

// Everything below is Eastern: these tests mean the org zone, whatever zone the machine is in.
const NOW = new Date("2026-11-17T15:00:00Z"); // 10:00 on Tuesday 17 Nov 2026, Eastern

const hoursBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 3_600_000;

describe("parseDayRange", () => {
  it("is no range, and no notice, when neither value is given", () => {
    expect(parseDayRange(undefined, undefined, NOW)).toEqual({ range: null, notice: null });
    expect(parseDayRange("", "  ", NOW)).toEqual({ range: null, notice: null });
  });

  it("reads a From and a To day", () => {
    expect(parseDayRange("2026-11-03", "2026-11-10", NOW)).toEqual({ range: { from: "2026-11-03", to: "2026-11-10" }, notice: null });
  });

  it("reads one day as a range of one day", () => {
    expect(parseDayRange("2026-11-03", "2026-11-03", NOW).range).toEqual({ from: "2026-11-03", to: "2026-11-03" });
  });

  it("takes the first of repeated parameters", () => {
    expect(parseDayRange(["2026-11-03", "2026-01-01"], ["2026-11-10"], NOW).range).toEqual({ from: "2026-11-03", to: "2026-11-10" });
  });

  it("runs a From alone to today, and a To alone from the floor", () => {
    expect(parseDayRange("2026-11-03", undefined, NOW).range).toEqual({ from: "2026-11-03", to: "2026-11-17" });
    expect(parseDayRange(undefined, "2026-11-03", NOW).range).toEqual({ from: RANGE_FLOOR, to: "2026-11-03" });
  });

  it("cuts a To day in the future to today", () => {
    expect(parseDayRange("2026-11-03", "2027-01-01", NOW).range).toEqual({ from: "2026-11-03", to: "2026-11-17" });
  });

  it("uses the Eastern day for today, not the UTC one", () => {
    // 23:30 Eastern on the 17th is already the 18th in UTC.
    const lateEvening = new Date("2026-11-18T04:30:00Z");
    expect(parseDayRange("2026-11-17", "2026-11-18", lateEvening).range).toEqual({ from: "2026-11-17", to: "2026-11-17" });
    expect(parseDayRange("2026-11-18", "2026-11-18", lateEvening)).toEqual({ range: null, notice: RANGE_NOTICES.future });
    // 00:30 Eastern on the 18th: the 18th has begun.
    const justAfterMidnight = new Date("2026-11-18T05:30:00Z");
    expect(parseDayRange("2026-11-18", "2026-11-18", justAfterMidnight).range).toEqual({ from: "2026-11-18", to: "2026-11-18" });
  });

  it("falls back, with a notice, for a range that runs backwards", () => {
    expect(parseDayRange("2026-11-10", "2026-11-03", NOW)).toEqual({ range: null, notice: RANGE_NOTICES.reversed });
  });

  it("falls back, with a notice, for a range that has not begun", () => {
    expect(parseDayRange("2026-11-18", "2026-12-01", NOW)).toEqual({ range: null, notice: RANGE_NOTICES.future });
  });

  it.each(["abc", "2026-02-30", "2026-13-01", "2026-1-5", "11/03/2026", "2026-11-03T00:00:00Z", "0026-01-01", "1999-12-31", "null", "-1"])(
    "falls back, with a notice, for %s",
    (garbage) => {
      expect(parseDayRange(garbage, "2026-11-10", NOW)).toEqual({ range: null, notice: RANGE_NOTICES.invalid });
      expect(parseDayRange("2026-11-03", garbage, NOW)).toEqual({ range: null, notice: RANGE_NOTICES.invalid });
    }
  );

  it("accepts the oldest day it allows, and refuses the day before it", () => {
    expect(parseDayRange("2000-01-01", "2000-01-02", NOW).range).toEqual({ from: "2000-01-01", to: "2000-01-02" });
    expect(parseDayRange("1999-12-31", "2000-01-02", NOW).notice).toBe(RANGE_NOTICES.invalid);
  });

  it("accepts a leap day only in a leap year", () => {
    expect(parseDayRange("2028-02-29", "2028-02-29", new Date("2028-03-01T15:00:00Z")).range).toEqual({ from: "2028-02-29", to: "2028-02-29" });
    expect(parseDayRange("2027-02-29", "2027-03-01", new Date("2027-03-02T15:00:00Z")).notice).toBe(RANGE_NOTICES.invalid);
  });
});

describe("rangeInstants", () => {
  it("starts at 00:00 Eastern of From and ends at 00:00 Eastern of the day after To, so the whole To day is included", () => {
    // Standard time (UTC-5).
    const { from, to } = rangeInstants({ from: "2026-11-03", to: "2026-11-03" });
    expect(from.toISOString()).toBe("2026-11-03T05:00:00.000Z");
    expect(to.toISOString()).toBe("2026-11-04T05:00:00.000Z");
    expect(hoursBetween(from, to)).toBe(24);
  });

  it("uses daylight time (UTC-4) in summer", () => {
    const { from, to } = rangeInstants({ from: "2026-07-01", to: "2026-07-31" });
    expect(from.toISOString()).toBe("2026-07-01T04:00:00.000Z");
    expect(to.toISOString()).toBe("2026-08-01T04:00:00.000Z");
  });

  it("reads the spring forward day (8 Mar 2026) as one day of 23 hours", () => {
    const { from, to } = rangeInstants({ from: "2026-03-08", to: "2026-03-08" });
    expect(from.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(to.toISOString()).toBe("2026-03-09T04:00:00.000Z");
    expect(hoursBetween(from, to)).toBe(23);
  });

  it("reads the fall back day (1 Nov 2026) as one day of 25 hours", () => {
    const { from, to } = rangeInstants({ from: "2026-11-01", to: "2026-11-01" });
    expect(from.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(to.toISOString()).toBe("2026-11-02T05:00:00.000Z");
    expect(hoursBetween(from, to)).toBe(25);
  });

  it("covers a range across a clock change without losing or gaining a day", () => {
    const { from, to } = rangeInstants({ from: "2026-03-07", to: "2026-03-09" });
    expect(hoursBetween(from, to)).toBe(24 + 23 + 24);
  });

  it("puts a late-evening event on its own Eastern day, and the next day's first minute on the next", () => {
    const { from, to } = rangeInstants({ from: "2026-11-03", to: "2026-11-03" });
    const lastMinute = new Date("2026-11-04T04:59:00Z"); // 23:59 Eastern on the 3rd
    const firstMinute = new Date("2026-11-04T05:00:00Z"); // 00:00 Eastern on the 4th
    expect(lastMinute >= from && lastMinute < to).toBe(true);
    expect(firstMinute >= from && firstMinute < to).toBe(false);
  });

  it("starts all time at the floor, at Eastern midnight", () => {
    expect(allTimeStart().toISOString()).toBe("2000-01-01T05:00:00.000Z");
    expect(rangeInstants({ from: RANGE_FLOOR, to: "2000-01-01" }).from.getTime()).toBe(allTimeStart().getTime());
  });

  it("is the same wherever the machine is", () => {
    expect(ORG_TIMEZONE).toBe("America/New_York");
    const { from } = rangeInstants({ from: "2026-11-03", to: "2026-11-03" });
    expect(new Intl.DateTimeFormat("en-CA", { timeZone: ORG_TIMEZONE, dateStyle: "short", timeStyle: "short", hourCycle: "h23" }).format(from)).toBe("2026-11-03, 00:00");
  });
});

describe("describeRange", () => {
  it("writes a range as day and month, without the year in the current year", () => {
    expect(describeRange({ from: "2026-11-03", to: "2026-11-17" }, NOW)).toBe("3 Nov to 17 Nov");
  });

  it("writes one day once", () => {
    expect(describeRange({ from: "2026-11-03", to: "2026-11-03" }, NOW)).toBe("3 Nov");
  });

  it("adds the year when the range is not wholly in the current year", () => {
    expect(describeRange({ from: "2025-11-03", to: "2025-11-17" }, NOW)).toBe("3 Nov 2025 to 17 Nov 2025");
    expect(describeRange({ from: "2025-12-20", to: "2026-01-05" }, NOW)).toBe("20 Dec 2025 to 5 Jan 2026");
  });

  it("uses the Eastern year for 'now': just after New Year's Eve in UTC is still last year in Eastern", () => {
    const lateNewYearsEve = new Date("2027-01-01T03:00:00Z"); // 22:00 on 31 Dec 2026, Eastern
    expect(describeRange({ from: "2026-12-30", to: "2026-12-31" }, lateNewYearsEve)).toBe("30 Dec to 31 Dec");
  });

  it("says 'up to' when the range starts at the floor", () => {
    expect(describeRange({ from: RANGE_FLOOR, to: "2026-11-03" }, NOW)).toBe("up to 3 Nov");
    expect(describeRange({ from: RANGE_FLOOR, to: "2025-11-03" }, NOW)).toBe("up to 3 Nov 2025");
  });

  it("formats a day without a zone", () => {
    expect(formatRangeDay("2026-03-08", false)).toBe("8 Mar");
    expect(formatRangeDay("2026-03-08", true)).toBe("8 Mar 2026");
  });
});
