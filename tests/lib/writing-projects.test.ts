import { describe, it, expect } from "vitest";
import {
  applyStartingBalance,
  computeCumulativeTotal,
  computeCumulativeSeries,
  computeGoalProgress,
  computeHabitGoalProgress,
  derivePrickleHabitEntries,
  MEASURE_QUICK_LOG_PRESETS,
  PROJECT_PHASES,
  PHASE_LABELS,
  WRITING_MEASURES,
  type ProgressEntryInput,
  type PrickleAttendanceRow,
} from "@/lib/writing-projects";

describe("PROJECT_PHASES", () => {
  it("includes 'outlining' between 'planning' and 'drafting', and keeps 'complete' unrenamed", () => {
    expect(PROJECT_PHASES.indexOf("outlining")).toBeGreaterThan(PROJECT_PHASES.indexOf("planning"));
    expect(PROJECT_PHASES.indexOf("outlining")).toBeLessThan(PROJECT_PHASES.indexOf("drafting"));
    expect(PROJECT_PHASES).toContain("complete");
    expect(PROJECT_PHASES).not.toContain("finished");
  });

  it("has a label for every phase", () => {
    for (const phase of PROJECT_PHASES) {
      expect(PHASE_LABELS[phase]).toBeTruthy();
    }
  });
});

describe("applyStartingBalance", () => {
  it("adds the starting balance to the total", () => {
    expect(applyStartingBalance(100, 50)).toBe(150);
  });

  it("treats an undefined starting balance as 0", () => {
    expect(applyStartingBalance(100, undefined)).toBe(100);
  });
});

describe("MEASURE_QUICK_LOG_PRESETS", () => {
  it("has a non-empty preset list for every loggable measure except 'prickles'", () => {
    for (const measure of WRITING_MEASURES) {
      if (measure === "prickles") {
        expect(MEASURE_QUICK_LOG_PRESETS[measure]).toBeUndefined();
        continue;
      }
      const presets = MEASURE_QUICK_LOG_PRESETS[measure];
      expect(presets).toBeDefined();
      expect(presets!.length).toBeGreaterThan(0);
      for (const preset of presets!) {
        expect(preset.label.length).toBeGreaterThan(0);
        expect(preset.amount).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

function entry(overrides: Partial<ProgressEntryInput> = {}): ProgressEntryInput {
  return {
    entryDate: "2026-08-01",
    createdAt: "2026-08-01T09:00:00Z",
    mode: "delta",
    amount: 0,
    ...overrides,
  };
}

describe("computeCumulativeTotal", () => {
  it("sums delta entries", () => {
    const total = computeCumulativeTotal([
      entry({ entryDate: "2026-08-01", createdAt: "2026-08-01T09:00:00Z", amount: 500 }),
      entry({ entryDate: "2026-08-02", createdAt: "2026-08-02T09:00:00Z", amount: 700 }),
    ]);
    expect(total).toBe(1200);
  });

  it("a set_total entry replaces the running total, later deltas add on top", () => {
    const total = computeCumulativeTotal([
      entry({ entryDate: "2026-08-01", createdAt: "2026-08-01T09:00:00Z", amount: 500 }),
      entry({ entryDate: "2026-08-02", createdAt: "2026-08-02T09:00:00Z", mode: "set_total", amount: 10000 }),
      entry({ entryDate: "2026-08-03", createdAt: "2026-08-03T09:00:00Z", amount: 200 }),
    ]);
    expect(total).toBe(10200);
  });

  it("recomputes correctly when entries are backdated (inserted out of chronological order)", () => {
    // Logged in this order: Aug 3, then a backdated Aug 1 entry, then Aug 2.
    const total = computeCumulativeTotal([
      entry({ entryDate: "2026-08-03", createdAt: "2026-08-03T09:00:00Z", amount: 200 }),
      entry({ entryDate: "2026-08-01", createdAt: "2026-08-03T09:05:00Z", amount: 500 }),
      entry({ entryDate: "2026-08-02", createdAt: "2026-08-03T09:10:00Z", mode: "set_total", amount: 10000 }),
    ]);
    // Chronological replay: Aug1 +500=500, Aug2 set_total=10000, Aug3 +200=10200 -- same
    // result regardless of insertion order, because replay order is by entryDate not createdAt.
    expect(total).toBe(10200);
  });

  it("zero and negative deltas are valid (an editing pass that cuts words still counts)", () => {
    const total = computeCumulativeTotal([
      entry({ entryDate: "2026-08-01", amount: 1000 }),
      entry({ entryDate: "2026-08-02", amount: -150 }),
      entry({ entryDate: "2026-08-03", amount: 0 }),
    ]);
    expect(total).toBe(850);
  });

  it("uses createdAt as a tiebreaker for same-day entries", () => {
    const total = computeCumulativeTotal([
      entry({ entryDate: "2026-08-01", createdAt: "2026-08-01T20:00:00Z", mode: "set_total", amount: 5000 }),
      entry({ entryDate: "2026-08-01", createdAt: "2026-08-01T09:00:00Z", amount: 500 }),
    ]);
    // Chronological by createdAt: +500 first -> 500, then set_total 5000 -> 5000.
    expect(total).toBe(5000);
  });

  it("returns 0 for no entries", () => {
    expect(computeCumulativeTotal([])).toBe(0);
  });
});

describe("computeCumulativeSeries", () => {
  it("returns the running total after each entry in chronological order", () => {
    const series = computeCumulativeSeries([
      entry({ entryDate: "2026-08-02", createdAt: "2026-08-02T09:00:00Z", amount: 700 }),
      entry({ entryDate: "2026-08-01", createdAt: "2026-08-01T09:00:00Z", amount: 500 }),
    ]);
    expect(series).toEqual([
      { entryDate: "2026-08-01", total: 500 },
      { entryDate: "2026-08-02", total: 1200 },
    ]);
  });

  it("collapses multiple same-day entries into one point holding that day's final total", () => {
    const series = computeCumulativeSeries([
      entry({ entryDate: "2026-08-01", createdAt: "2026-08-01T09:00:00Z", amount: 500 }),
      entry({ entryDate: "2026-08-01", createdAt: "2026-08-01T10:00:00Z", amount: 250 }),
      entry({ entryDate: "2026-08-02", createdAt: "2026-08-02T09:00:00Z", amount: 700 }),
    ]);
    expect(series).toEqual([
      { entryDate: "2026-08-01", total: 750 },
      { entryDate: "2026-08-02", total: 1450 },
    ]);
  });
});

describe("computeGoalProgress", () => {
  const now = new Date("2026-08-16T00:00:00Z");

  it("computes percent complete with no end date (no par line)", () => {
    const progress = computeGoalProgress({
      entries: [entry({ entryDate: "2026-08-01", amount: 25000 })],
      targetAmount: 50000,
      startDate: null,
      endDate: null,
      now,
    });
    expect(progress.current).toBe(25000);
    expect(progress.percent).toBe(50);
    expect(progress.parTarget).toBeNull();
    expect(progress.onPace).toBeNull();
  });

  it("computes a par target at the halfway point of a 30-day window", () => {
    // Aug 1 - Aug 31 = 30 days elapsed at target date; "now" (Aug 16) is 15 days in.
    const progress = computeGoalProgress({
      entries: [entry({ entryDate: "2026-08-01", amount: 20000 })],
      targetAmount: 50000,
      startDate: "2026-08-01",
      endDate: "2026-08-31",
      now,
    });
    expect(progress.parTarget).toBeCloseTo(25000, 0);
    expect(progress.onPace).toBe(false); // 20000 < ~25000
  });

  it("onPace is true when current meets or exceeds the par target", () => {
    const progress = computeGoalProgress({
      entries: [entry({ entryDate: "2026-08-01", amount: 30000 })],
      targetAmount: 50000,
      startDate: "2026-08-01",
      endDate: "2026-08-31",
      now,
    });
    expect(progress.onPace).toBe(true);
  });

  it("excludes entries outside the goal's date window", () => {
    const progress = computeGoalProgress({
      entries: [
        entry({ entryDate: "2026-07-15", amount: 40000 }), // before window
        entry({ entryDate: "2026-08-05", amount: 10000 }), // in window
      ],
      targetAmount: 50000,
      startDate: "2026-08-01",
      endDate: "2026-08-31",
      now,
    });
    expect(progress.current).toBe(10000);
  });

  it("clamps parTarget to the target amount once the window has fully elapsed", () => {
    const progress = computeGoalProgress({
      entries: [entry({ entryDate: "2026-08-01", amount: 10000 })],
      targetAmount: 50000,
      startDate: "2026-08-01",
      endDate: "2026-08-05",
      now, // now is well past the end date
    });
    expect(progress.parTarget).toBe(50000);
    expect(progress.onPace).toBe(false);
  });
});

describe("computeHabitGoalProgress", () => {
  const now = new Date("2026-08-16T12:00:00Z"); // a Sunday

  it("returns all zeros for no entries", () => {
    const progress = computeHabitGoalProgress({ entries: [], period: "day", threshold: null, now });
    expect(progress).toEqual({ currentStreak: 0, longestStreak: 0, typicalStreak: 0, hitRatePercent: 0 });
  });

  it("counts a run of consecutive days ending today as the current streak", () => {
    const progress = computeHabitGoalProgress({
      entries: [
        { entryDate: "2026-08-14", amount: 1 },
        { entryDate: "2026-08-15", amount: 1 },
        { entryDate: "2026-08-16", amount: 1 },
      ],
      period: "day",
      threshold: null,
      now,
    });
    expect(progress.currentStreak).toBe(3);
    expect(progress.longestStreak).toBe(3);
  });

  it("grants a grace day -- a streak ending yesterday is still active today (today isn't over)", () => {
    const progress = computeHabitGoalProgress({
      entries: [
        { entryDate: "2026-08-14", amount: 1 },
        { entryDate: "2026-08-15", amount: 1 },
      ],
      period: "day",
      threshold: null,
      now,
    });
    expect(progress.currentStreak).toBe(2);
  });

  it("breaks the current streak once more than a full period has elapsed since the last hit", () => {
    const progress = computeHabitGoalProgress({
      entries: [
        { entryDate: "2026-08-10", amount: 1 },
        { entryDate: "2026-08-11", amount: 1 },
        { entryDate: "2026-08-14", amount: 1 }, // isolated -- 2 days before "now"
      ],
      period: "day",
      threshold: null,
      now,
    });
    expect(progress.currentStreak).toBe(0);
    expect(progress.longestStreak).toBe(2);
  });

  it("only counts a period as a hit when its total meets the threshold", () => {
    // now (Aug 16, a Sunday) falls in the Mon Aug10-Sun Aug16 week.
    const progress = computeHabitGoalProgress({
      entries: [
        // week of Aug 3-9: totals 1500, hits the 1000 threshold
        { entryDate: "2026-08-03", amount: 800 },
        { entryDate: "2026-08-05", amount: 700 },
        // week of Aug 10-16 (the current week, still in progress): totals 800, misses
        { entryDate: "2026-08-11", amount: 800 },
      ],
      period: "week",
      threshold: 1000,
      now,
    });
    expect(progress.longestStreak).toBe(1);
    // The only hit week is the one immediately before the current (still in-progress,
    // missed-so-far) week -- same grace window as the daily case above.
    expect(progress.currentStreak).toBe(1);
  });

  it("typicalStreak averages the length of all completed hit-runs", () => {
    const progress = computeHabitGoalProgress({
      entries: [
        { entryDate: "2026-01-01", amount: 1 },
        { entryDate: "2026-01-02", amount: 1 },
        { entryDate: "2026-01-03", amount: 1 }, // run of 3
        { entryDate: "2026-01-10", amount: 1 }, // run of 1
      ],
      period: "day",
      threshold: null,
      now, // far past both runs -- current streak is 0
    });
    expect(progress.currentStreak).toBe(0);
    expect(progress.longestStreak).toBe(3);
    expect(progress.typicalStreak).toBe(2); // (3 + 1) / 2
  });

  it("computes hitRatePercent as hit periods over periods tracked since the first entry", () => {
    // 5 daily periods tracked (Aug 12-16), 3 of them hit (12, 13, 16), 2 missed (14, 15)
    const progress = computeHabitGoalProgress({
      entries: [
        { entryDate: "2026-08-12", amount: 1 },
        { entryDate: "2026-08-13", amount: 1 },
        { entryDate: "2026-08-16", amount: 1 },
      ],
      period: "day",
      threshold: null,
      now,
    });
    expect(progress.hitRatePercent).toBe(60);
  });
});

function attendance(overrides: Partial<PrickleAttendanceRow> = {}): PrickleAttendanceRow {
  return { typeId: "type-progress", hostId: "host-1", localDate: "2026-08-03", ...overrides };
}

describe("derivePrickleHabitEntries", () => {
  it("counts everything when the anchor is fully unset (any writing prickle counts)", () => {
    const rows = [attendance({ localDate: "2026-08-03" }), attendance({ localDate: "2026-08-10" })];
    const result = derivePrickleHabitEntries(rows, { typeId: null, hostId: null, dayOfWeek: null });
    expect(result).toEqual(
      expect.arrayContaining([
        { entryDate: "2026-08-03", amount: 1 },
        { entryDate: "2026-08-10", amount: 1 },
      ])
    );
    expect(result).toHaveLength(2);
  });

  it("filters by typeId alone", () => {
    const rows = [attendance({ typeId: "type-progress" }), attendance({ typeId: "type-sprint", localDate: "2026-08-04" })];
    const result = derivePrickleHabitEntries(rows, { typeId: "type-progress", hostId: null, dayOfWeek: null });
    expect(result).toEqual([{ entryDate: "2026-08-03", amount: 1 }]);
  });

  it("filters by hostId alone", () => {
    const rows = [attendance({ hostId: "host-1" }), attendance({ hostId: "host-2", localDate: "2026-08-04" })];
    const result = derivePrickleHabitEntries(rows, { typeId: null, hostId: "host-1", dayOfWeek: null });
    expect(result).toEqual([{ entryDate: "2026-08-03", amount: 1 }]);
  });

  it("filters by dayOfWeek alone, derived from each row's local date", () => {
    // 2026-08-03 is a Monday (dayOfWeek 1), 2026-08-04 is a Tuesday (dayOfWeek 2).
    const rows = [attendance({ localDate: "2026-08-03" }), attendance({ localDate: "2026-08-04" })];
    const result = derivePrickleHabitEntries(rows, { typeId: null, hostId: null, dayOfWeek: 1 });
    expect(result).toEqual([{ entryDate: "2026-08-03", amount: 1 }]);
  });

  it("applies type/host/day filters together (AND, not OR) -- this is the 'Jenn's Progress Prickle' case", () => {
    const rows = [
      attendance({ typeId: "type-progress", hostId: "host-1", localDate: "2026-08-03" }), // matches all three
      attendance({ typeId: "type-progress", hostId: "host-2", localDate: "2026-08-03" }), // wrong host
      attendance({ typeId: "type-sprint", hostId: "host-1", localDate: "2026-08-03" }), // wrong type
      attendance({ typeId: "type-progress", hostId: "host-1", localDate: "2026-08-04" }), // wrong day
    ];
    const result = derivePrickleHabitEntries(rows, { typeId: "type-progress", hostId: "host-1", dayOfWeek: 1 });
    expect(result).toEqual([{ entryDate: "2026-08-03", amount: 1 }]);
  });

  it("groups multiple matching prickles on the same date into one entry with amount > 1", () => {
    const rows = [attendance({ localDate: "2026-08-03" }), attendance({ localDate: "2026-08-03" })];
    const result = derivePrickleHabitEntries(rows, { typeId: null, hostId: null, dayOfWeek: null });
    expect(result).toEqual([{ entryDate: "2026-08-03", amount: 2 }]);
  });

  it("returns an empty array when nothing matches", () => {
    const rows = [attendance({ typeId: "type-progress" })];
    const result = derivePrickleHabitEntries(rows, { typeId: "type-sprint", hostId: null, dayOfWeek: null });
    expect(result).toEqual([]);
  });
});
