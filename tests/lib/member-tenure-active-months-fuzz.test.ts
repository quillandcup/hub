import { describe, it } from "vitest";
import fc from "fast-check";
import { computeTotalActiveMonths } from "@/lib/member-tenure";
import type { ActiveWindow, HiatusWindow } from "@/lib/member-tenure";
import type { MembershipPurchase } from "@/lib/kajabi/membership-history";

const DAY = 86400000;
const BASE = Date.UTC(2020, 0, 1);
const ASOF = new Date(Date.UTC(2026, 10, 25, 12));

const dayArb = fc.integer({ min: 0, max: 3000 });
const iso = (d: number) => new Date(BASE + d * DAY).toISOString();
const spanArb = fc
  .tuple(dayArb, fc.option(fc.integer({ min: 0, max: 800 }), { nil: null }))
  .map(([start, len]) => ({ start: iso(start), end: len === null ? null : iso(start + len) }));

const stintsArb = fc.array(spanArb, { maxLength: 6 }).map((spans): MembershipPurchase[] =>
  spans.map((s) => ({ created_at_kajabi: s.start, derived_end_at: s.end, status: s.end ? "canceled" : "active", kajabi_offer_id: "o" }))
);
const windowsArb = fc.array(spanArb, { maxLength: 4 }) as fc.Arbitrary<ActiveWindow[]>;
const hiatusArb = fc
  .array(spanArb, { maxLength: 4 })
  .map((spans): HiatusWindow[] => spans.map((s) => ({ startsAt: s.start, endsAt: s.end })));
const overrideArb = fc.option(dayArb.map(iso), { nil: null });

const run = { numRuns: 300 };
const calc = (s: MembershipPurchase[], w: ActiveWindow[], h: HiatusWindow[], o: string | null, at = ASOF) =>
  computeTotalActiveMonths(s, w, h, o, at);

describe("computeTotalActiveMonths properties", () => {
  it("is a non-negative integer", () => {
    fc.assert(
      fc.property(stintsArb, windowsArb, hiatusArb, overrideArb, (s, w, h, o) => {
        const m = calc(s, w, h, o);
        return Number.isInteger(m) && m >= 0;
      }),
      run
    );
  });

  it("does not depend on input order", () => {
    fc.assert(
      fc.property(stintsArb, windowsArb, hiatusArb, overrideArb, (s, w, h, o) => {
        return calc(s, w, h, o) === calc([...s].reverse(), [...w].reverse(), [...h].reverse(), o);
      }),
      run
    );
  });

  it("is unchanged by duplicating a stint, a window or a hiatus", () => {
    fc.assert(
      fc.property(stintsArb, windowsArb, hiatusArb, overrideArb, (s, w, h, o) => {
        return calc(s, w, h, o) === calc([...s, ...s], [...w, ...w], [...h, ...h], o);
      }),
      run
    );
  });

  it("never drops when coverage is added or a hiatus is removed", () => {
    fc.assert(
      fc.property(stintsArb, stintsArb, windowsArb, windowsArb, hiatusArb, overrideArb, (s, extraS, w, extraW, h, o) => {
        const base = calc(s, w, h, o);
        return calc([...s, ...extraS], [...w, ...extraW], h, o) >= base && calc(s, w, h.slice(1), o) >= base;
      }),
      run
    );
  });

  it("is at most the days from the earliest start to asOf, over 30", () => {
    fc.assert(
      fc.property(stintsArb, windowsArb, hiatusArb, overrideArb, (s, w, h, o) => {
        const starts = [...s.map((x) => x.created_at_kajabi), ...w.map((x) => x.start), ...(o ? [o] : [])].map((d) =>
          new Date(d).getTime()
        );
        if (starts.length === 0) return calc(s, w, h, o) === 0;
        const span = Math.max(0, ASOF.getTime() - Math.min(...starts));
        return calc(s, w, h, o) <= Math.floor(span / (30 * DAY));
      }),
      run
    );
  });

  it("never drops as asOf moves later", () => {
    fc.assert(
      fc.property(
        stintsArb,
        windowsArb,
        hiatusArb,
        overrideArb,
        fc.integer({ min: 0, max: 2000 }),
        fc.integer({ min: 0, max: 800 }),
        (s, w, h, o, a, extra) => {
          const t1 = new Date(BASE + a * DAY);
          const t2 = new Date(BASE + (a + extra) * DAY);
          return calc(s, w, h, o, t2) >= calc(s, w, h, o, t1);
        }
      ),
      run
    );
  });
});
