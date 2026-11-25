import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { computeInactiveGaps, type ActiveWindow } from "@/lib/member-tenure";
import type { MembershipPurchase } from "@/lib/kajabi/membership-history";

// Property-based tests (fast-check) over the dated "not a member" gaps. Dates are generated as day offsets
// from a fixed base, so nothing depends on the clock or the machine's zone.
const BASE = Date.UTC(2020, 0, 1);
const day = (n: number) => new Date(BASE + n * 86_400_000).toISOString().slice(0, 10);

const window = fc
  .record({ start: fc.integer({ min: 0, max: 1500 }), length: fc.integer({ min: 0, max: 400 }), open: fc.boolean() })
  .map(({ start, length, open }) => ({ start: day(start), end: open ? null : day(start + length) }));

const toStint = (w: ActiveWindow): MembershipPurchase => ({
  created_at_kajabi: `${w.start}T10:00:00Z`,
  derived_end_at: w.end ? `${w.end}T10:00:00Z` : null,
  status: w.end ? "canceled" : "active",
  kajabi_offer_id: "offer",
});

const covers = (w: ActiveWindow, date: string) => w.start <= date && (w.end === null || date < w.end);

describe("computeInactiveGaps (fuzz)", () => {
  it("returns sorted, disjoint, non-empty gaps that no coverage overlaps", () => {
    fc.assert(
      fc.property(fc.array(window, { maxLength: 6 }), fc.array(window, { maxLength: 6 }), (stintWindows, others) => {
        const gaps = computeInactiveGaps(stintWindows.map(toStint), null, others);
        const all = [...stintWindows, ...others];
        for (let i = 0; i < gaps.length; i++) {
          expect(gaps[i].end! > gaps[i].start).toBe(true);
          if (i > 0) expect(gaps[i].start >= gaps[i - 1].end!).toBe(true);
          // Every day in the gap is outside every window (a gap is a gap in the merged coverage).
          for (let d = BASE; d < Date.parse(gaps[i].end!); d += 86_400_000 * 7) {
            const date = new Date(d).toISOString().slice(0, 10);
            if (date < gaps[i].start) continue;
            expect(all.some((w) => covers(w, date))).toBe(false);
          }
          // Later coverage always follows a gap (no trailing gap).
          expect(all.some((w) => w.start >= gaps[i].end!)).toBe(true);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("does not depend on the order of the stints or the other coverage", () => {
    fc.assert(
      fc.property(fc.array(window, { maxLength: 6 }), fc.array(window, { maxLength: 6 }), fc.integer(), (stintWindows, others, seed) => {
        const rotate = <T,>(xs: T[]) => (xs.length === 0 ? xs : [...xs.slice(Math.abs(seed) % xs.length), ...xs.slice(0, Math.abs(seed) % xs.length)].reverse());
        const a = computeInactiveGaps(stintWindows.map(toStint), null, others);
        const b = computeInactiveGaps(rotate(stintWindows).map(toStint), null, rotate(others));
        expect(b).toEqual(a);
      }),
      { numRuns: 300 },
    );
  });

  it("splitting one window into two touching ones changes nothing, and a cutoff only removes gaps", () => {
    fc.assert(
      fc.property(fc.array(window, { maxLength: 5 }), fc.integer({ min: 0, max: 1900 }), (windows, cut) => {
        const full = computeInactiveGaps([], null, windows);
        const closed = windows.filter((w) => w.end !== null && w.end > w.start);
        if (closed.length > 0) {
          const first = closed[0];
          const mid = day(Math.floor((Date.parse(first.start) + Date.parse(first.end!)) / 2 / 86_400_000) - BASE / 86_400_000);
          const split = [{ start: first.start, end: mid }, { start: mid, end: first.end }, ...windows.slice(windows.indexOf(first) + 1), ...windows.slice(0, windows.indexOf(first))];
          expect(computeInactiveGaps([], null, split)).toEqual(computeInactiveGaps([], null, windows));
        }
        const cutoff = day(cut);
        expect(computeInactiveGaps([], cutoff, windows)).toEqual(full.filter((g) => g.end! > cutoff));
      }),
      { numRuns: 300 },
    );
  });
});
