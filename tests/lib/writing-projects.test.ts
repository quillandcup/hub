import { describe, it, expect } from "vitest";
import {
  computeCumulativeTotal,
  computeCumulativeSeries,
  computeGoalProgress,
  type ProgressEntryInput,
} from "@/lib/writing-projects";

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
