import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { computeMemberTenure, type ActiveWindow } from "@/lib/member-tenure";
import type { MembershipPurchase } from "@/lib/kajabi/membership-history";

// Property-based tests (fast-check) over first-joined and most-recent-joined with program / gift coverage.
// Dates are day offsets from a fixed base and "now" is pinned, so nothing depends on the clock or the zone.
const BASE = Date.UTC(2020, 0, 1);
const day = (n: number) => new Date(BASE + n * 86_400_000).toISOString().slice(0, 10);
const AS_OF = new Date("2027-01-01T12:00:00Z");

const window = fc
  .record({ start: fc.integer({ min: 0, max: 1500 }), length: fc.integer({ min: 0, max: 400 }), open: fc.boolean() })
  .map(({ start, length, open }) => ({ start: day(start), end: open ? null : day(start + length) }));

const toStint = (w: ActiveWindow): MembershipPurchase => ({
  created_at_kajabi: `${w.start}T10:00:00Z`,
  derived_end_at: w.end ? `${w.end}T10:00:00Z` : null,
  status: w.end ? "canceled" : "active",
  kajabi_offer_id: "offer",
});

const stintWindows = fc.array(window, { minLength: 1, maxLength: 5 });
const coverage = fc.array(window, { maxLength: 5 });
const reversed = <T,>(xs: T[]) => [...xs].reverse();

describe("computeMemberTenure first and most recent joined (fuzz)", () => {
  it("first-joined is on or before every stint start and coverage start, and most-recent is not before it", () => {
    fc.assert(
      fc.property(stintWindows, coverage, (stints, others) => {
        const t = computeMemberTenure(stints.map(toStint), [], AS_OF, others);
        for (const w of [...stints, ...others]) expect(t.firstJoinedAt! <= w.start).toBe(true);
        expect(t.mostRecentJoinedAt! >= t.firstJoinedAt!).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it("does not depend on the order of the stints or the coverage", () => {
    fc.assert(
      fc.property(stintWindows, coverage, (stints, others) => {
        const a = computeMemberTenure(stints.map(toStint), [], AS_OF, others);
        const b = computeMemberTenure(reversed(stints).map(toStint), [], AS_OF, reversed(others));
        expect(b).toEqual(a);
      }),
      { numRuns: 300 },
    );
  });

  it("adding coverage that starts earlier never moves first-joined later", () => {
    fc.assert(
      fc.property(stintWindows, coverage, window, (stints, others, extra) => {
        const before = computeMemberTenure(stints.map(toStint), [], AS_OF, others).firstJoinedAt!;
        const after = computeMemberTenure(stints.map(toStint), [], AS_OF, [...others, extra]).firstJoinedAt!;
        expect(after <= before).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it("with no coverage, first-joined is the earliest stint start and an empty list equals leaving it out", () => {
    fc.assert(
      fc.property(stintWindows, (stints) => {
        const t = computeMemberTenure(stints.map(toStint), [], AS_OF);
        expect(t.firstJoinedAt).toBe(stints.map((w) => w.start).sort()[0]);
        expect(computeMemberTenure(stints.map(toStint), [], AS_OF, [])).toEqual(t);
      }),
      { numRuns: 300 },
    );
  });

  it("coverage that starts inside a stint and ends with it never changes the dates", () => {
    fc.assert(
      fc.property(window, fc.integer({ min: 0, max: 100 }), (w, offset) => {
        const start = day(Date.parse(w.start) / 86_400_000 - BASE / 86_400_000 + offset);
        if (w.end !== null && start >= w.end) return;
        const stints = [toStint(w)];
        const t = computeMemberTenure(stints, [], AS_OF);
        const withInside = computeMemberTenure(stints, [], AS_OF, [{ start, end: w.end }]);
        expect(withInside).toEqual(t);
      }),
      { numRuns: 300 },
    );
  });
});
