import { describe, it, expect } from "vitest";
import {
  computeActiveDays,
  computeMemberTenure,
  computeCumulativeHiatusMonths,
  computeInactiveGaps,
  calendarMonthsBetween,
  mergeInactivePeriods,
  resolveHedgieversaryClock,
  roundLabel,
  RETURN_GAP_MIN_DAYS,
  isCurrentlyOnHiatus,
  nextHedgieversaryDate,
  hedgieversaryMilestonesInWindow,
  milestoneLabel,
} from "@/lib/member-tenure";
import type { HiatusWindow, InactivePeriod } from "@/lib/member-tenure";
import type { MembershipPurchase } from "@/lib/kajabi/membership-history";

function stint(start: string, end: string | null): MembershipPurchase {
  return {
    created_at_kajabi: start,
    derived_end_at: end,
    status: end ? "canceled" : "active",
    kajabi_offer_id: "offer",
  };
}

describe("computeActiveDays", () => {
  it("returns full duration when there's no overlapping hiatus", () => {
    expect(computeActiveDays("2024-01-01", "2024-01-31", [], new Date("2024-02-01"))).toBe(30);
  });

  it("subtracts an overlapping hiatus window", () => {
    const hiatus: HiatusWindow[] = [{ startsAt: "2024-01-10", endsAt: "2024-01-20" }];
    expect(computeActiveDays("2024-01-01", "2024-01-31", hiatus, new Date("2024-02-01"))).toBe(20);
  });

  it("treats an ongoing (endsAt null) hiatus as open until asOf", () => {
    const hiatus: HiatusWindow[] = [{ startsAt: "2024-01-10", endsAt: null }];
    // range is 30 days (Jan1-Jan31); hiatus has only run 10 days so far (Jan10-Jan20)
    expect(computeActiveDays("2024-01-01", "2024-01-31", hiatus, new Date("2024-01-20"))).toBe(20);
  });

  it("ignores a hiatus window entirely outside the range", () => {
    const hiatus: HiatusWindow[] = [{ startsAt: "2025-01-01", endsAt: "2025-02-01" }];
    expect(computeActiveDays("2024-01-01", "2024-01-31", hiatus, new Date("2024-02-01"))).toBe(30);
  });
});

describe("computeMemberTenure", () => {
  it("returns nulls/0 for no stints", () => {
    const result = computeMemberTenure([], [], new Date("2024-01-01"));
    expect(result).toEqual({ firstJoinedAt: null, mostRecentJoinedAt: null, totalActiveMonths: 0 });
  });

  it("a single continuous membership: first == most recent joined", () => {
    const result = computeMemberTenure(
      [stint("2024-01-01T00:00:00Z", null)],
      [],
      new Date("2024-01-31T00:00:00Z")
    );
    expect(result.firstJoinedAt).toBe("2024-01-01");
    expect(result.mostRecentJoinedAt).toBe("2024-01-01");
    expect(result.totalActiveMonths).toBe(1); // 30 days
  });

  it("cancel+resubscribe: most recent joined differs from first joined", () => {
    const result = computeMemberTenure(
      [
        stint("2023-01-01T00:00:00Z", "2023-01-31T00:00:00Z"),
        stint("2023-03-02T00:00:00Z", null),
      ],
      [],
      new Date("2023-04-01T00:00:00Z")
    );
    expect(result.firstJoinedAt).toBe("2023-01-01");
    expect(result.mostRecentJoinedAt).toBe("2023-03-02");
    expect(result.totalActiveMonths).toBe(2); // 30 + 30 days
  });

  it("an ended hiatus resets most-recent-joined to the hiatus end date, and its time is excluded from the total", () => {
    const hiatus: HiatusWindow[] = [{ startsAt: "2022-01-16T00:00:00Z", endsAt: "2022-02-15T00:00:00Z" }];
    const result = computeMemberTenure(
      [stint("2022-01-01T00:00:00Z", null)],
      hiatus,
      new Date("2022-03-02T00:00:00Z")
    );
    expect(result.firstJoinedAt).toBe("2022-01-01");
    expect(result.mostRecentJoinedAt).toBe("2022-02-15"); // hiatus end, not the original join date
    expect(result.totalActiveMonths).toBe(1); // 60 day window - 30 hiatus days = 30 active days
  });

  it("an ongoing (not-yet-ended) hiatus does NOT reset most-recent-joined, but still excludes elapsed time from the total", () => {
    const hiatus: HiatusWindow[] = [{ startsAt: "2022-02-01T00:00:00Z", endsAt: null }];
    const result = computeMemberTenure(
      [stint("2022-01-01T00:00:00Z", null)],
      hiatus,
      new Date("2022-03-03T00:00:00Z")
    );
    expect(result.firstJoinedAt).toBe("2022-01-01");
    expect(result.mostRecentJoinedAt).toBe("2022-01-01"); // unchanged — they haven't returned yet
    expect(result.totalActiveMonths).toBe(1); // 61 day window - 30 hiatus-so-far days = 31 active days
  });

  it("a hiatus that ended more recently than any resubscription wins as most-recent-joined", () => {
    const hiatus: HiatusWindow[] = [{ startsAt: "2021-01-01T00:00:00Z", endsAt: "2021-04-01T00:00:00Z" }];
    const result = computeMemberTenure(
      [
        stint("2020-01-01T00:00:00Z", "2020-06-01T00:00:00Z"),
        stint("2020-07-01T00:00:00Z", null), // real resubscribe on 2020-07-01
      ],
      hiatus,
      new Date("2021-05-01T00:00:00Z")
    );
    expect(result.mostRecentJoinedAt).toBe("2021-04-01"); // hiatus end is later than the 2020-07-01 resub
  });

  it("does not treat a same-day plan-change purchase as a resubscribe", () => {
    const result = computeMemberTenure(
      [
        stint("2024-01-01T00:00:00Z", "2024-06-01T00:00:00Z"),
        stint("2024-06-01T00:00:00Z", null), // starts same instant the prior one ends — no real gap
      ],
      [],
      new Date("2024-07-01T00:00:00Z")
    );
    expect(result.mostRecentJoinedAt).toBe(result.firstJoinedAt);
  });
});

describe("computeCumulativeHiatusMonths", () => {
  it("returns 0 for no hiatus windows", () => {
    expect(computeCumulativeHiatusMonths([], new Date("2024-01-01"))).toBe(0);
  });

  it("sums ended and ongoing windows, rounded to the nearest whole month", () => {
    const windows: HiatusWindow[] = [
      { startsAt: "2023-01-01T00:00:00Z", endsAt: "2023-02-01T00:00:00Z" }, // 31 days, ended
      { startsAt: "2023-06-01T00:00:00Z", endsAt: null }, // ongoing — open until asOf
    ];
    // 31 days ended + 29 days ongoing (Jun1-Jun30) = 60 days -> round(60/30) = 2
    expect(computeCumulativeHiatusMonths(windows, new Date("2023-06-30T00:00:00Z"))).toBe(2);
  });
});

describe("isCurrentlyOnHiatus", () => {
  it("is true for an open-ended (no end date) hiatus that's already started", () => {
    const windows: HiatusWindow[] = [{ startsAt: "2024-01-01", endsAt: null }];
    expect(isCurrentlyOnHiatus(windows, new Date("2024-02-01"))).toBe(true);
  });

  it("is true mid-way through a hiatus that has a known future end date", () => {
    // The bug this guards against: a hiatus with a planned return date is
    // still a *current* hiatus while it's running -- a milestone date
    // can't be allowed to land inside it just because the end date is known.
    const windows: HiatusWindow[] = [{ startsAt: "2024-01-01", endsAt: "2024-03-01" }];
    expect(isCurrentlyOnHiatus(windows, new Date("2024-02-01"))).toBe(true);
  });

  it("is false once a known-end-date hiatus has ended", () => {
    const windows: HiatusWindow[] = [{ startsAt: "2024-01-01", endsAt: "2024-03-01" }];
    expect(isCurrentlyOnHiatus(windows, new Date("2024-04-01"))).toBe(false);
  });

  it("is false for a hiatus that hasn't started yet", () => {
    const windows: HiatusWindow[] = [{ startsAt: "2024-06-01", endsAt: null }];
    expect(isCurrentlyOnHiatus(windows, new Date("2024-01-01"))).toBe(false);
  });

  it("is false with no hiatus windows", () => {
    expect(isCurrentlyOnHiatus([], new Date("2024-01-01"))).toBe(false);
  });
});

describe("calendarMonthsBetween", () => {
  it("counts exact calendar months", () => {
    expect(calendarMonthsBetween("2023-09-15", "2023-12-15")).toBe(3);
  });

  it("rounds a few leftover days down", () => {
    expect(calendarMonthsBetween("2024-01-16", "2025-01-19")).toBe(12);
  });

  it("rounds half a month or more up", () => {
    expect(calendarMonthsBetween("2024-01-01", "2024-02-16")).toBe(2); // 15 of 29 days is past half
    expect(calendarMonthsBetween("2024-01-01", "2024-02-14")).toBe(1); // 13 of 29 days is under half
  });

  it("counts three years as 36, not 37", () => {
    expect(calendarMonthsBetween("2021-03-10", "2024-03-10")).toBe(36);
    expect(calendarMonthsBetween("2021-03-10", "2024-03-09")).toBe(36); // a day short of 36 rounds to 36
  });

  it("clamps the day of month from a month-end start", () => {
    // Jan 31 + 1 month is Feb 29 (2024), so Feb 29 is exactly one month.
    expect(calendarMonthsBetween("2024-01-31", "2024-02-29")).toBe(1);
    expect(calendarMonthsBetween("2024-01-31", "2024-03-31")).toBe(2);
  });

  it("is 0 for an empty or backwards period", () => {
    expect(calendarMonthsBetween("2024-01-01", "2024-01-01")).toBe(0);
    expect(calendarMonthsBetween("2024-02-01", "2024-01-01")).toBe(0);
  });
});

describe("mergeInactivePeriods", () => {
  const asOf = new Date("2025-06-01T12:00:00Z");

  it("merges overlapping periods so the shared time counts once", () => {
    const merged = mergeInactivePeriods(
      [
        { start: "2024-01-01", end: "2024-04-01" },
        { start: "2024-03-01", end: "2024-05-01" },
      ],
      asOf
    );
    expect(merged).toEqual([{ start: "2024-01-01", end: "2024-05-01", months: 4 }]);
  });

  it("merges periods that touch", () => {
    const merged = mergeInactivePeriods(
      [
        { start: "2024-01-01", end: "2024-02-01" },
        { start: "2024-02-01", end: "2024-03-01" },
      ],
      asOf
    );
    expect(merged).toEqual([{ start: "2024-01-01", end: "2024-03-01", months: 2 }]);
  });

  it("keeps separate periods apart and sorts them", () => {
    const merged = mergeInactivePeriods(
      [
        { start: "2024-06-01", end: "2024-07-01" },
        { start: "2024-01-01", end: "2024-02-01" },
      ],
      asOf
    );
    expect(merged.map((p) => p.start)).toEqual(["2024-01-01", "2024-06-01"]);
  });

  it("closes an open period at asOf", () => {
    expect(mergeInactivePeriods([{ start: "2025-03-01", end: null }], asOf)).toEqual([
      { start: "2025-03-01", end: "2025-06-01", months: 3 },
    ]);
  });

  it("does not let a future open period run backwards", () => {
    expect(mergeInactivePeriods([{ start: "2026-01-01", end: null }], asOf)).toEqual([
      { start: "2026-01-01", end: "2026-01-01", months: 0 },
    ]);
  });
});

describe("computeInactiveGaps", () => {
  it("returns the dated gap between two stints", () => {
    const gaps = computeInactiveGaps([
      stint("2023-01-01T10:00:00Z", "2023-04-10T10:00:00Z"),
      stint("2023-08-20T10:00:00Z", null),
    ]);
    expect(gaps).toEqual([{ start: "2023-04-10", end: "2023-08-20" }]);
  });

  it("returns no gap for a continuous membership or a same-day plan change", () => {
    expect(computeInactiveGaps([stint("2023-01-01", null)])).toEqual([]);
    expect(
      computeInactiveGaps([
        stint("2023-01-01T10:00:00Z", "2023-06-01T10:00:00Z"),
        stint("2023-06-01T10:00:00Z", null),
      ])
    ).toEqual([]);
  });

  it("drops gaps that ended before the effective first-joined date (join-date override)", () => {
    const stints = [
      stint("2023-01-01T10:00:00Z", "2023-02-01T10:00:00Z"),
      stint("2023-03-01T10:00:00Z", "2023-09-01T10:00:00Z"),
      stint("2024-01-01T10:00:00Z", null),
    ];
    expect(computeInactiveGaps(stints, "2023-06-01")).toEqual([{ start: "2023-09-01", end: "2024-01-01" }]);
  });
});

describe("resolveHedgieversaryClock", () => {
  it("keeps the first-joined date when there are no gaps, or gaps were never computed (null)", () => {
    const hiatus = [{ startsAt: "2023-01-01", endsAt: "2023-02-01" }];
    for (const gaps of [null, undefined, []]) {
      expect(resolveHedgieversaryClock("2022-09-23", hiatus, gaps)).toEqual({
        startDate: "2022-09-23",
        returns: 0,
        restartedAt: null,
        periods: [{ start: "2023-01-01", end: "2023-02-01" }],
      });
    }
  });

  it("is a return from RETURN_GAP_MIN_DAYS (60) days, not before", () => {
    expect(RETURN_GAP_MIN_DAYS).toBe(60);
    // 2024-01-01 to 2024-02-29 is 59 days, to 2024-03-01 is 60 days
    expect(resolveHedgieversaryClock("2023-01-01", [], [{ start: "2024-01-01", end: "2024-02-29" }]).restartedAt).toBeNull();
    const exact = resolveHedgieversaryClock("2023-01-01", [], [{ start: "2024-01-01", end: "2024-03-01" }]);
    expect(exact.restartedAt).toBe("2024-03-01");
    expect(exact.startDate).toBe("2024-03-01");
    expect(exact.returns).toBe(1);
  });

  it("ignores a short gap next to a long one: the long return restarts, the blip does nothing", () => {
    const clock = resolveHedgieversaryClock("2022-09-23", [], [
      { start: "2022-11-23", end: "2026-04-28" },
      { start: "2026-07-27", end: "2026-08-12" },
    ]);
    expect(clock.startDate).toBe("2026-04-28");
    expect(clock.returns).toBe(1);
  });

  it("uses the latest of two returns", () => {
    const clock = resolveHedgieversaryClock("2020-01-01", [], [
      { start: "2021-01-01", end: "2021-06-01" },
      { start: "2023-01-01", end: "2023-09-01" },
    ]);
    expect(clock.startDate).toBe("2023-09-01");
    expect(clock.returns).toBe(2);
  });

  it("drops hiatus windows that began before the restart and keeps later ones", () => {
    const clock = resolveHedgieversaryClock(
      "2023-07-05",
      [
        { startsAt: "2023-08-05", endsAt: "2024-02-05" },
        { startsAt: "2026-09-01", endsAt: "2026-10-01" },
      ],
      [{ start: "2024-04-05", end: "2026-06-03" }]
    );
    expect(clock.startDate).toBe("2026-06-03");
    expect(clock.periods).toEqual([{ start: "2026-09-01", end: "2026-10-01" }]);
  });
});

describe("roundLabel", () => {
  it("names the round once a member has returned", () => {
    expect(roundLabel(0)).toBeNull();
    expect(roundLabel(1)).toBe("second time around");
    expect(roundLabel(2)).toBe("third time around");
    expect(roundLabel(7)).toBe("#8 time around");
  });
});

describe("a returning member's milestones count from the return", () => {
  const asOf = new Date("2026-09-01T00:00:00Z");
  it("restarts the clock at the latest long gap and ignores the short one", () => {
    const clock = resolveHedgieversaryClock("2022-09-23", [], [
      { start: "2022-11-23", end: "2026-04-28" },
      { start: "2026-07-27", end: "2026-08-12" },
    ]);
    const result = nextHedgieversaryDate(clock.startDate, clock.periods, false, asOf);
    expect(result.nextDate).toBe("2026-10-28");
    expect(result.milestoneMonths).toBe(6);
    // The first stint's milestones are not produced, only counts from the return
    const all = hedgieversaryMilestonesInWindow(clock.startDate, clock.periods, false, new Date("2028-01-01T00:00:00Z"), 0);
    expect(all.map((m) => m.date)).toEqual(["2026-10-28", "2027-04-28"]);
  });

  it("restarts after a hiatus then a gap, with the hiatus before the return ignored", () => {
    const clock = resolveHedgieversaryClock(
      "2023-07-05",
      [{ startsAt: "2023-08-05", endsAt: "2024-02-05" }],
      [{ start: "2024-04-05", end: "2026-06-03" }]
    );
    expect(clock.restartedAt).toBe("2026-06-03");
    expect(nextHedgieversaryDate(clock.startDate, clock.periods, false, asOf).nextDate).toBe("2026-12-03");
  });

  it("a hiatus after the return shifts the later milestones, not the earlier ones", () => {
    const clock = resolveHedgieversaryClock(
      "2022-09-23",
      [{ startsAt: "2026-06-01", endsAt: "2026-09-01" }],
      [{ start: "2022-11-23", end: "2026-04-28" }]
    );
    // 6 months from 2026-04-28 is 2026-10-28; the hiatus began 2026-06-01, before it: +3 months
    const all = hedgieversaryMilestonesInWindow(clock.startDate, clock.periods, false, new Date("2028-01-01T00:00:00Z"), 0);
    expect(all.map((m) => m.date)).toEqual(["2027-01-28", "2027-07-28"]);
  });

  it("clamps the day of month from the restart date", () => {
    const clock = resolveHedgieversaryClock("2020-01-01", [], [{ start: "2020-03-01", end: "2023-08-31" }]);
    expect(nextHedgieversaryDate(clock.startDate, clock.periods, false, new Date("2023-09-01T00:00:00Z")).nextDate).toBe("2024-02-29");
  });

  it("still reports nothing for a member currently on hiatus", () => {
    const clock = resolveHedgieversaryClock("2022-09-23", [{ startsAt: "2026-08-15", endsAt: null }], [{ start: "2022-11-23", end: "2026-04-28" }]);
    expect(nextHedgieversaryDate(clock.startDate, clock.periods, true, asOf).nextDate).toBeNull();
    expect(hedgieversaryMilestonesInWindow(clock.startDate, clock.periods, true, asOf, 30)).toEqual([]);
  });
});

describe("nextHedgieversaryDate", () => {
  it("lands on the 6-month mark before any yearly milestone", () => {
    const result = nextHedgieversaryDate("2024-01-01", [], false, new Date("2024-03-01"));
    expect(result).toEqual({
      nextDate: "2024-07-01",
      milestoneMonths: 6,
      recentDate: null,
      recentMilestoneMonths: null,
    });
  });

  it("steps to the next yearly milestone once the 6-month mark has passed, flagging it as recent", () => {
    // asOf is only 31 days after the 6-month mark (2024-07-01) — within the
    // 90-day recent window, so it's surfaced as recentDate rather than
    // silently dropped in favor of the 1-year mark.
    const result = nextHedgieversaryDate("2024-01-01", [], false, new Date("2024-08-01"));
    expect(result).toEqual({
      nextDate: "2025-01-01",
      milestoneMonths: 12,
      recentDate: "2024-07-01",
      recentMilestoneMonths: 6,
    });
  });

  it("does not flag a milestone as recent once it's outside the window", () => {
    // 1-year mark (2025-01-01) is 120 days before asOf — past the 90-day
    // recent window, so it's not surfaced alongside the 2-year mark.
    const result = nextHedgieversaryDate("2024-01-01", [], false, new Date("2025-05-01"));
    expect(result.recentDate).toBeNull();
    expect(result.recentMilestoneMonths).toBeNull();
  });

  it("steps to the 2-year mark once the 1-year mark has passed", () => {
    const result = nextHedgieversaryDate("2024-01-01", [], false, new Date("2025-02-01"));
    expect(result.nextDate).toBe("2026-01-01");
    expect(result.milestoneMonths).toBe(24);
  });

  it("shifts a milestone that falls after a hiatus by the hiatus length", () => {
    // 3 months of hiatus (Feb 1 to May 1) pushes the 6-month mark from 2024-07-01 to 2024-10-01
    const result = nextHedgieversaryDate("2024-01-01", [{ start: "2024-02-01", end: "2024-05-01" }], false, new Date("2024-06-01"));
    expect(result.nextDate).toBe("2024-10-01");
    expect(result.milestoneMonths).toBe(6);
    expect(result.recentDate).toBeNull();
  });

  it("returns TBD (null) for a member currently on hiatus", () => {
    const result = nextHedgieversaryDate("2024-01-01", [], true, new Date("2024-03-01"));
    expect(result).toEqual({
      nextDate: null,
      milestoneMonths: null,
      recentDate: null,
      recentMilestoneMonths: null,
    });
  });

  it("clamps day-of-month instead of overflowing into the next month", () => {
    // Aug 31 + 6 months = Feb 28/29, not Mar 3 (2025 isn't a leap year)
    const result = nextHedgieversaryDate("2024-08-31", [], false, new Date("2025-01-01"));
    expect(result.nextDate).toBe("2025-02-28");
    expect(result.milestoneMonths).toBe(6);
  });
});

describe("milestoneLabel", () => {
  it("labels sub-year milestones in months", () => {
    expect(milestoneLabel(6)).toBe("6-Month");
  });

  it("labels year-plus milestones in years", () => {
    expect(milestoneLabel(12)).toBe("1-Year");
    expect(milestoneLabel(36)).toBe("3-Year");
  });
});

describe("hedgieversaryMilestonesInWindow", () => {
  it("returns every milestone reached, not just the latest", () => {
    // First joined 2024-01-01, asOf 2025-06-15 — both the 6mo and 1yr marks
    // have passed (the next, 2yr, hasn't); a member who's fallen behind on
    // celebrations needs both surfaced, not only the most recent.
    const result = hedgieversaryMilestonesInWindow("2024-01-01", [], false, new Date("2025-06-15"), 0);
    expect(result).toEqual([
      { date: "2024-07-01", milestoneMonths: 6 },
      { date: "2025-01-01", milestoneMonths: 12 },
    ]);
  });

  it("includes a near-future milestone within the lookahead window", () => {
    const result = hedgieversaryMilestonesInWindow("2024-01-01", [], false, new Date("2024-06-20"), 14);
    expect(result).toEqual([{ date: "2024-07-01", milestoneMonths: 6 }]);
  });

  it("excludes a milestone beyond the lookahead window", () => {
    const result = hedgieversaryMilestonesInWindow("2024-01-01", [], false, new Date("2024-06-01"), 14);
    expect(result).toEqual([]);
  });

  it("returns nothing for a member currently on hiatus", () => {
    const result = hedgieversaryMilestonesInWindow("2024-01-01", [], true, new Date("2025-06-01"), 0);
    expect(result).toEqual([]);
  });

  it("shifts a milestone that falls after a hiatus by the hiatus length", () => {
    const result = hedgieversaryMilestonesInWindow(
      "2024-01-01",
      [{ start: "2024-02-01", end: "2024-05-01" }],
      false,
      new Date("2024-10-05"),
      0
    );
    expect(result).toEqual([{ date: "2024-10-01", milestoneMonths: 6 }]);
  });
});

describe("milestones and inactive periods (the spreadsheet rule)", () => {
  const asOf = new Date("2030-01-01T00:00:00Z");
  const dates = (periods: InactivePeriod[], first = "2022-01-15") =>
    hedgieversaryMilestonesInWindow(first, periods, false, asOf, 0)
      .slice(0, 5)
      .map((m) => m.date);

  it("never moves a milestone already reached before a hiatus began", () => {
    // 6 months is 2022-07-15, reached before the hiatus; 12 months (2023-01-15) falls after it starts
    const result = dates([{ start: "2022-09-15", end: "2022-12-15" }]);
    expect(result[0]).toBe("2022-07-15");
    expect(result[1]).toBe("2023-04-15"); // 12 months + 3
    expect(result[2]).toBe("2024-04-15");
  });

  it("shifts a milestone after the hiatus, not the one before it", () => {
    const withHiatus = dates([{ start: "2022-08-01", end: "2022-09-01" }]);
    expect(withHiatus[0]).toBe("2022-07-15");
    expect(withHiatus[1]).toBe("2023-02-15");
  });

  it("with two hiatuses, a milestone between them is shifted only by the first", () => {
    const result = dates([
      { start: "2022-02-01", end: "2022-04-01" }, // 2 months, before the 6-month mark
      { start: "2023-06-01", end: "2023-09-01" }, // 3 months, after the 12-month mark
    ]);
    expect(result[0]).toBe("2022-09-15"); // 6 + 2
    expect(result[1]).toBe("2023-03-15"); // 12 + 2, reached before the second hiatus
    expect(result[2]).toBe("2024-06-15"); // 24 + 2 + 3
  });

  it("counts overlapping hiatuses once", () => {
    const overlapping = dates([
      { start: "2022-02-01", end: "2022-05-01" },
      { start: "2022-03-01", end: "2022-06-01" },
    ]);
    const single = dates([{ start: "2022-02-01", end: "2022-06-01" }]);
    expect(overlapping).toEqual(single);
    expect(overlapping[0]).toBe("2022-11-15"); // 6 + 4, not 6 + 3 + 3
  });

  it("a 3-year hiatus shifts later milestones by 36 months, not 37", () => {
    const result = dates([{ start: "2022-03-01", end: "2025-03-01" }]);
    expect(result[0]).toBe("2025-07-15"); // 6 + 36
  });

  it("clamps the day of month when a shifted milestone lands in a shorter month", () => {
    const result = hedgieversaryMilestonesInWindow(
      "2023-07-31",
      [{ start: "2023-08-01", end: "2023-09-01" }],
      false,
      asOf,
      0
    );
    expect(result[0].date).toBe("2024-02-29"); // Jul 31 + 7 months, clamped to the leap-year Feb
  });

  it("null/empty periods give the plain first-joined schedule", () => {
    expect(dates([])[0]).toBe("2022-07-15");
  });

  it("reports no next date or queue items for a member currently on hiatus", () => {
    const now = new Date("2024-03-01T00:00:00Z");
    const periods = [{ start: "2024-02-01", end: null }];
    expect(nextHedgieversaryDate("2023-01-01", periods, true, now).nextDate).toBeNull();
    expect(hedgieversaryMilestonesInWindow("2023-01-01", periods, true, now, 30)).toEqual([]);
  });

  it("keeps the 90-day recent-milestone behaviour with a shift in play", () => {
    // 6-month mark shifted to 2024-10-01 by a hiatus; asOf is 40 days after it
    const result = nextHedgieversaryDate(
      "2024-01-01",
      [{ start: "2024-02-01", end: "2024-05-01" }],
      false,
      new Date("2024-11-10T00:00:00Z")
    );
    expect(result.recentDate).toBe("2024-10-01");
    expect(result.recentMilestoneMonths).toBe(6);
    expect(result.milestoneMonths).toBe(12);
    expect(result.nextDate).toBe("2025-04-01");
  });
});
