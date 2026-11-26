import { describe, it, expect } from "vitest";
import {
  computeActiveDays,
  computeMemberTenure,
  computeCumulativeHiatusMonths,
  computeInactiveGaps,
  computeTotalActiveMonths,
  calendarMonthsBetween,
  mergeInactivePeriods,
  toInactivePeriods,
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

describe("computeInactiveGaps with program and override coverage", () => {
  const stints = [stint("2023-04-18T10:00:00Z", "2023-09-18T10:00:00Z")];
  const program = { start: "2026-06-14", end: "2026-12-10" };

  it("finds the trailing gap before a program cohort that no later Kajabi stint closes", () => {
    expect(computeInactiveGaps(stints, "2023-04-18", [program])).toEqual([{ start: "2023-09-18", end: "2026-06-14" }]);
  });

  it("moves the next Hedgieversary from the 4-year mark to the 6-month one for that member", () => {
    const gaps = computeInactiveGaps(stints, "2023-04-18", [program]);
    const hiatus: HiatusWindow[] = [{ startsAt: "2023-04-18", endsAt: "2023-09-18" }];
    const periods = toInactivePeriods(hiatus, gaps);
    const next = nextHedgieversaryDate("2023-04-18", periods, false, new Date("2026-11-25T12:00:00Z"));
    expect(next.milestoneMonths).toBe(6);
    expect(next.nextDate && next.nextDate >= "2026-12-01" && next.nextDate <= "2027-01-31").toBe(true);

    const stale = nextHedgieversaryDate("2023-04-18", toInactivePeriods(hiatus, []), false, new Date("2026-11-25T12:00:00Z"));
    expect(stale.milestoneMonths).not.toBe(6);
  });

  it("counts gift and direct Stripe windows (timestamps and open ends) as coverage", () => {
    expect(
      computeInactiveGaps(stints, null, [
        { start: "2024-01-01T00:00:00Z", end: "2024-03-01T00:00:00Z" },
        { start: "2024-05-01T00:00:00Z", end: null },
      ])
    ).toEqual([
      { start: "2023-09-18", end: "2024-01-01" },
      { start: "2024-03-01", end: "2024-05-01" },
    ]);
  });

  it("leaves no gap where windows overlap or touch", () => {
    expect(
      computeInactiveGaps(stints, null, [
        { start: "2023-09-01", end: "2023-12-01" },
        { start: "2023-12-01", end: "2024-02-01" },
      ])
    ).toEqual([]);
  });

  it("drops a gap that ends on or before the first-joined date", () => {
    expect(computeInactiveGaps(stints, "2026-06-14", [program])).toEqual([]);
  });

  it("reports no trailing gap after the last coverage, and handles a member with no stints", () => {
    expect(computeInactiveGaps(stints, null, [])).toEqual([]);
    expect(computeInactiveGaps([], null, [])).toEqual([]);
    expect(computeInactiveGaps([], null, [program])).toEqual([]);
    expect(computeInactiveGaps([], null, [{ start: "2025-01-01", end: "2025-03-01" }, program])).toEqual([
      { start: "2025-03-01", end: "2026-06-14" },
    ]);
  });

  it("lets an open-ended stint cover a later cancelled stint (no gap after it)", () => {
    expect(
      computeInactiveGaps([stint("2023-01-01T10:00:00Z", null), stint("2023-03-01T10:00:00Z", "2023-04-01T10:00:00Z")])
    ).toEqual([]);
  });
});

describe("toInactivePeriods", () => {
  it("combines hiatus windows with gaps, as dates", () => {
    expect(
      toInactivePeriods([{ startsAt: "2024-01-01T00:00:00Z", endsAt: null }], [{ start: "2023-01-01", end: "2023-02-01" }])
    ).toEqual([
      { start: "2024-01-01", end: null },
      { start: "2023-01-01", end: "2023-02-01" },
    ]);
  });

  it("falls back to hiatus only when gaps were never computed (null)", () => {
    expect(toInactivePeriods([{ startsAt: "2024-01-01", endsAt: "2024-02-01" }], null)).toEqual([
      { start: "2024-01-01", end: "2024-02-01" },
    ]);
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

  it("shifts for a cancel/resubscribe gap exactly like a hiatus", () => {
    const period = { start: "2022-02-01", end: "2022-05-01" };
    const viaHiatus = toInactivePeriods([{ startsAt: period.start, endsAt: period.end }], null);
    const viaGap = toInactivePeriods([], [period]);
    expect(dates(viaGap)).toEqual(dates(viaHiatus));
    expect(dates(viaGap)[0]).toBe("2022-10-15");
  });

  it("a long cancel/resubscribe gap keeps the original start: earlier milestones stay, later ones are pushed out by the gap's calendar months", () => {
    // Joined 2022-01-15, left 2022-11-23, came back 2026-04-28 (41 months and 5 days: 41).
    const gap = { start: "2022-11-23", end: "2026-04-28" };
    const result = hedgieversaryMilestonesInWindow("2022-01-15", toInactivePeriods([], [gap]), false, new Date("2030-01-01T00:00:00Z"), 0);
    expect(result[0]).toEqual({ date: "2022-07-15", milestoneMonths: 6 }); // reached before the gap: unchanged
    expect(result[1]).toEqual({ date: "2026-06-15", milestoneMonths: 12 }); // 12 + 41 months
    expect(result[2]).toEqual({ date: "2027-06-15", milestoneMonths: 24 });
  });

  it("counts a gap shorter than 60 days like any other gap", () => {
    // 2022-02-01 to 2022-03-20 is 47 days: 2 months once rounded, and it pushes the 6-month mark out
    const result = dates(toInactivePeriods([], [{ start: "2022-02-01", end: "2022-03-20" }]));
    expect(result[0]).toBe("2022-09-15"); // 6 + 2
  });

  it("a hiatus and a gap that overlap are one period", () => {
    const result = dates(
      toInactivePeriods([{ startsAt: "2022-02-01", endsAt: "2022-04-01" }], [{ start: "2022-03-01", end: "2022-05-01" }])
    );
    expect(result[0]).toBe("2022-10-15"); // Feb 1 to May 1 = 3 months
  });

  it("a 3-year gap shifts later milestones by 36 months, not 37", () => {
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
    expect(dates(toInactivePeriods([], null))[0]).toBe("2022-07-15");
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

describe("computeTotalActiveMonths", () => {
  const asOf = new Date("2026-11-25T12:00:00Z");
  const total = (
    stints: ReturnType<typeof stint>[],
    other: { start: string; end: string | null }[] = [],
    hiatus: HiatusWindow[] = [],
    override: string | null = null,
    at: Date = asOf
  ) => computeTotalActiveMonths(stints, other, hiatus, override, at);

  it("is 0 with no coverage", () => {
    expect(total([])).toBe(0);
  });

  it("adds a program that does not overlap the membership (5 + 5 months)", () => {
    const membership = stint("2023-04-18", "2023-09-18");
    expect(total([membership])).toBe(5);
    expect(total([membership], [{ start: "2026-06-14", end: "2026-12-14" }])).toBe(10);
  });

  it("counts a program or gift inside a membership once", () => {
    const membership = stint("2024-01-01", "2024-07-01");
    expect(total([membership], [{ start: "2024-02-01", end: "2024-04-01" }])).toBe(total([membership]));
  });

  it("counts two stints running side by side once", () => {
    const a = stint("2024-01-01", null);
    const b = stint("2024-03-01", null);
    expect(total([a, b])).toBe(total([a]));
  });

  it("counts a 2-day plan-change overlap once", () => {
    // 180 days each, overlapping 2 days: 358 days together is 11 months, not 6 + 6
    const first = stint("2024-01-01", "2024-06-29");
    const second = stint("2024-06-27", "2024-12-24");
    expect(total([first, second], [], [], null, new Date("2025-01-01"))).toBe(11);
    expect(Math.floor(181 / 30) + Math.floor(181 / 30)).toBe(12);
  });

  it("with a join-date override equals the time since the override, minus hiatus", () => {
    const hiatus: HiatusWindow[] = [{ startsAt: "2024-01-01", endsAt: "2024-03-01" }];
    const days = (asOf.getTime() - new Date("2022-01-01").getTime()) / 86400000 - 60;
    expect(total([stint("2023-01-01", null)], [], hiatus, "2022-01-01")).toBe(Math.floor(days / 30));
  });

  it("subtracts a hiatus that overlaps a stint, and counts overlapping hiatus windows once", () => {
    const s = stint("2024-01-01", "2024-07-01"); // 182 days
    expect(total([s], [], [{ startsAt: "2024-02-01", endsAt: "2024-03-02" }])).toBe(Math.floor(152 / 30));
    expect(
      total([s], [], [
        { startsAt: "2024-02-01", endsAt: "2024-03-02" },
        { startsAt: "2024-02-15", endsAt: "2024-03-02" },
      ])
    ).toBe(Math.floor(152 / 30));
  });

  it("treats a hiatus open at asOf as running until asOf", () => {
    expect(total([stint("2026-01-01", null)], [], [{ startsAt: "2026-05-01", endsAt: null }], null, new Date("2026-09-01"))).toBe(
      Math.floor(120 / 30)
    );
  });

  it("ignores a program that starts after asOf and clips one that ends after it", () => {
    expect(total([], [{ start: "2026-12-01", end: "2027-06-01" }])).toBe(0);
    expect(total([], [{ start: "2026-08-26", end: "2027-06-01" }])).toBe(3); // 91.5 days to asOf
  });

  it("rounds down at the 30 day boundary", () => {
    expect(total([stint("2024-01-01", "2024-01-30")])).toBe(0); // 29 days
    expect(total([stint("2024-01-01", "2024-01-31")])).toBe(1); // 30 days
  });

  it("never goes negative when hiatus covers everything", () => {
    expect(total([stint("2024-01-01", "2024-03-01")], [], [{ startsAt: "2023-01-01", endsAt: null }])).toBe(0);
  });
});
