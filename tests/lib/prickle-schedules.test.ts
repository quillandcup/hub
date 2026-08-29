import { describe, it, expect } from "vitest";
import {
  getMonthStart,
  getMonthEnd,
  getNextMonthStart,
  isMonthLocked,
  generateScheduleInstanceDates,
  summarizeMonth,
  validateScheduleInput,
  formatScheduleLabel,
} from "@/lib/prickle-schedules";

describe("month boundaries", () => {
  it("computes month start/end within a normal month", () => {
    const now = new Date("2026-09-15T12:00:00Z");
    expect(getMonthStart(now).toISOString().slice(0, 10)).toBe("2026-09-01");
    expect(getMonthEnd(now).toISOString().slice(0, 10)).toBe("2026-09-30");
  });

  it("rolls over Dec -> Jan for next month start", () => {
    const now = new Date("2026-12-15T12:00:00Z");
    expect(getNextMonthStart(now).toISOString().slice(0, 10)).toBe("2027-01-01");
  });

  it("handles a leap-year February", () => {
    const now = new Date("2028-02-10T00:00:00Z");
    expect(getMonthEnd(now).toISOString().slice(0, 10)).toBe("2028-02-29");
  });

  it("handles a non-leap-year February", () => {
    const now = new Date("2026-02-10T00:00:00Z");
    expect(getMonthEnd(now).toISOString().slice(0, 10)).toBe("2026-02-28");
  });
});

describe("isMonthLocked", () => {
  const now = new Date("2026-09-15T12:00:00Z");

  it("defaults to locked for the current month with no override", () => {
    expect(isMonthLocked(getMonthStart(now), [], now)).toBe(true);
  });

  it("defaults to locked for a past month with no override", () => {
    expect(isMonthLocked(new Date("2026-08-01T00:00:00Z"), [], now)).toBe(true);
  });

  it("defaults to open for a future month with no override", () => {
    expect(isMonthLocked(getNextMonthStart(now), [], now)).toBe(false);
  });

  it("an explicit unlock override wins over the current-month default", () => {
    const overrides = [{ month: "2026-09-01", locked: false }];
    expect(isMonthLocked(getMonthStart(now), overrides, now)).toBe(false);
  });

  it("an explicit lock override wins over the future-month default", () => {
    const overrides = [{ month: "2026-10-01", locked: true }];
    expect(isMonthLocked(getNextMonthStart(now), overrides, now)).toBe(true);
  });
});

describe("generateScheduleInstanceDates", () => {
  const monthStart = new Date("2026-09-01T00:00:00Z");
  const monthEnd = new Date("2026-09-30T00:00:00Z");

  it("weekly: every matching weekday in the month", () => {
    // September 2026: Tuesdays fall on 1, 8, 15, 22, 29
    const dates = generateScheduleInstanceDates(
      {
        recurrenceType: "weekly",
        dayOfWeek: 2,
        recurrenceAnchorDate: null,
        weekOfMonth: null,
        eventDate: null,
        startTimeLocal: "19:00",
        timezone: "America/New_York",
      },
      monthStart,
      monthEnd
    );
    expect(dates.map((d) => d.toISOString().slice(0, 10))).toEqual([
      "2026-09-01",
      "2026-09-08",
      "2026-09-15",
      "2026-09-22",
      "2026-09-29",
    ]);
  });

  it("biweekly: alternating weekdays filtered by anchor parity", () => {
    const dates = generateScheduleInstanceDates(
      {
        recurrenceType: "biweekly",
        dayOfWeek: 2,
        recurrenceAnchorDate: "2026-09-01",
        weekOfMonth: null,
        eventDate: null,
        startTimeLocal: "19:00",
        timezone: "America/New_York",
      },
      monthStart,
      monthEnd
    );
    expect(dates.map((d) => d.toISOString().slice(0, 10))).toEqual(["2026-09-01", "2026-09-15", "2026-09-29"]);
  });

  it("monthly: the single Nth-weekday occurrence", () => {
    // 3rd Thursday of September 2026 = Sep 17
    const dates = generateScheduleInstanceDates(
      {
        recurrenceType: "monthly",
        dayOfWeek: 4,
        recurrenceAnchorDate: null,
        weekOfMonth: 3,
        eventDate: null,
        startTimeLocal: "18:00",
        timezone: "America/New_York",
      },
      monthStart,
      monthEnd
    );
    expect(dates.map((d) => d.toISOString().slice(0, 10))).toEqual(["2026-09-17"]);
  });

  it("monthly: empty when the Nth occurrence doesn't exist (no 5th Friday)", () => {
    // September 2026 has only four Fridays (4, 11, 18, 25)
    const dates = generateScheduleInstanceDates(
      {
        recurrenceType: "monthly",
        dayOfWeek: 5,
        recurrenceAnchorDate: null,
        weekOfMonth: 5,
        eventDate: null,
        startTimeLocal: "18:00",
        timezone: "America/New_York",
      },
      monthStart,
      monthEnd
    );
    expect(dates).toEqual([]);
  });

  it("one_off: the event date when it falls in range", () => {
    const dates = generateScheduleInstanceDates(
      {
        recurrenceType: "one_off",
        dayOfWeek: null,
        recurrenceAnchorDate: null,
        weekOfMonth: null,
        eventDate: "2026-09-12",
        startTimeLocal: "14:00",
        timezone: "America/New_York",
      },
      monthStart,
      monthEnd
    );
    expect(dates.map((d) => d.toISOString().slice(0, 10))).toEqual(["2026-09-12"]);
  });

  it("one_off: empty when the event date falls outside the month", () => {
    const dates = generateScheduleInstanceDates(
      {
        recurrenceType: "one_off",
        dayOfWeek: null,
        recurrenceAnchorDate: null,
        weekOfMonth: null,
        eventDate: "2026-10-12",
        startTimeLocal: "14:00",
        timezone: "America/New_York",
      },
      monthStart,
      monthEnd
    );
    expect(dates).toEqual([]);
  });
});

describe("summarizeMonth", () => {
  it("counts by status", () => {
    const result = summarizeMonth([
      { status: "proposed" },
      { status: "confirmed" },
      { status: "confirmed" },
      { status: "declined" },
    ]);
    expect(result).toEqual({ proposed: 1, confirmed: 2, declined: 1 });
  });

  it("returns zeros for an empty list", () => {
    expect(summarizeMonth([])).toEqual({ proposed: 0, confirmed: 0, declined: 0 });
  });
});

describe("validateScheduleInput", () => {
  const base = { typeId: "t1", month: "2026-09-01", startTimeLocal: "19:00" };

  it("accepts a valid weekly input", () => {
    expect(validateScheduleInput({ ...base, recurrenceType: "weekly", dayOfWeek: 2 })).toBeNull();
  });

  it("rejects weekly without day_of_week", () => {
    expect(validateScheduleInput({ ...base, recurrenceType: "weekly" })).toMatch(/day_of_week is required/);
  });

  it("rejects biweekly without recurrence_anchor_date", () => {
    expect(validateScheduleInput({ ...base, recurrenceType: "biweekly", dayOfWeek: 2 })).toMatch(
      /recurrence_anchor_date is required/
    );
  });

  it("accepts a valid biweekly input", () => {
    expect(
      validateScheduleInput({ ...base, recurrenceType: "biweekly", dayOfWeek: 2, recurrenceAnchorDate: "2026-09-01" })
    ).toBeNull();
  });

  it("rejects monthly without week_of_month", () => {
    expect(validateScheduleInput({ ...base, recurrenceType: "monthly", dayOfWeek: 4 })).toMatch(
      /week_of_month is required/
    );
  });

  it("rejects one_off without event_date", () => {
    expect(validateScheduleInput({ ...base, recurrenceType: "one_off" })).toMatch(/event_date is required/);
  });

  it("rejects an out-of-range day_of_week", () => {
    expect(validateScheduleInput({ ...base, recurrenceType: "weekly", dayOfWeek: 7 })).toMatch(
      /day_of_week must be between/
    );
  });

  it("rejects an unknown recurrence_type", () => {
    expect(validateScheduleInput({ ...base, recurrenceType: "yearly" as any })).toMatch(/recurrence_type must be one of/);
  });
});

describe("formatScheduleLabel", () => {
  it("labels a weekly schedule", () => {
    const label = formatScheduleLabel("Progress Prickle", {
      recurrenceType: "weekly",
      dayOfWeek: 2,
      recurrenceAnchorDate: null,
      weekOfMonth: null,
      eventDate: null,
      startTimeLocal: "19:00",
      timezone: "America/New_York",
    });
    expect(label).toContain("Progress Prickle");
    expect(label).toContain("Tuesday");
  });

  it("renders the given wall-clock hour as-is, regardless of the host machine's own timezone", () => {
    // Regression test: formatTime must not silently reinterpret
    // start_time_local through the runtime's local timezone (browsers and
    // Node can differ, e.g. UTC in CI vs Pacific in a developer's Chrome) --
    // "19:00" in America/New_York must always render as 7 PM, never shift.
    const label = formatScheduleLabel("Progress Prickle", {
      recurrenceType: "weekly",
      dayOfWeek: 2,
      recurrenceAnchorDate: null,
      weekOfMonth: null,
      eventDate: null,
      startTimeLocal: "19:00",
      timezone: "America/New_York",
    });
    expect(label).toContain("7 PM");
  });

  it("labels a one_off schedule with its date", () => {
    const label = formatScheduleLabel("Community Potluck", {
      recurrenceType: "one_off",
      dayOfWeek: null,
      recurrenceAnchorDate: null,
      weekOfMonth: null,
      eventDate: "2026-09-12",
      startTimeLocal: "14:00",
      timezone: "America/New_York",
    });
    expect(label).toContain("Community Potluck");
    expect(label).toContain("Sep 12");
  });
});
