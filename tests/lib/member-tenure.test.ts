import { describe, it, expect } from "vitest";
import {
  computeActiveDays,
  computeMemberTenure,
  computeCumulativeHiatusMonths,
  nextHedgieversaryDate,
} from "@/lib/member-tenure";
import type { HiatusWindow } from "@/lib/member-tenure";
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

describe("nextHedgieversaryDate", () => {
  it("lands on the 6-month mark before any yearly milestone", () => {
    const result = nextHedgieversaryDate("2024-01-01", 0, false, new Date("2024-03-01"));
    expect(result).toEqual({ nextDate: "2024-07-01", milestoneMonths: 6 });
  });

  it("steps to the next yearly milestone once the 6-month mark has passed", () => {
    const result = nextHedgieversaryDate("2024-01-01", 0, false, new Date("2024-08-01"));
    expect(result).toEqual({ nextDate: "2025-01-01", milestoneMonths: 12 });
  });

  it("steps to the 2-year mark once the 1-year mark has passed", () => {
    const result = nextHedgieversaryDate("2024-01-01", 0, false, new Date("2025-02-01"));
    expect(result).toEqual({ nextDate: "2026-01-01", milestoneMonths: 24 });
  });

  it("shifts the milestone date forward by cumulative hiatus months", () => {
    // 3 months of hiatus pushes the 6-month mark from 2024-07-01 to 2024-10-01
    const result = nextHedgieversaryDate("2024-01-01", 3, false, new Date("2024-03-01"));
    expect(result).toEqual({ nextDate: "2024-10-01", milestoneMonths: 6 });
  });

  it("returns TBD (null) for a member currently on an indefinite hiatus", () => {
    const result = nextHedgieversaryDate("2024-01-01", 0, true, new Date("2024-03-01"));
    expect(result).toEqual({ nextDate: null, milestoneMonths: null });
  });

  it("clamps day-of-month instead of overflowing into the next month", () => {
    // Aug 31 + 6 months = Feb 28/29, not Mar 3 (2025 isn't a leap year)
    const result = nextHedgieversaryDate("2024-08-31", 0, false, new Date("2025-01-01"));
    expect(result).toEqual({ nextDate: "2025-02-28", milestoneMonths: 6 });
  });
});
