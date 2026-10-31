import { describe, it, expect, vi, beforeEach } from "vitest";
import { monthsBefore, rollUpAndPruneUsageEvents, USAGE_RETENTION_BUDGET_MS } from "@/lib/retention/usage-events";
import { RETENTION } from "@/lib/retention";
import { ORG_TIMEZONE } from "@/lib/config";
import { useFakeClock } from "@/tests/helpers/fake-clock";

type Call = { fn: string; args: Record<string, unknown> };

function fakeDb(script: {
  periods?: { period_kind: string; period_start: string }[];
  rows?: number[];
  pruned?: number[];
  error?: { fn: string; message: string };
}) {
  const calls: Call[] = [];
  const rows = [...(script.rows ?? [])];
  const pruned = [...(script.pruned ?? [])];
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    if (script.error?.fn === fn) return { data: null, error: { message: script.error.message } };
    if (fn === "analytics_unrolled_periods") return { data: script.periods ?? [], error: null };
    if (fn === "analytics_rollup_period") return { data: rows.shift() ?? 0, error: null };
    if (fn === "analytics_prune_usage_events") return { data: pruned.shift() ?? 0, error: null };
    throw new Error(`unexpected rpc ${fn}`);
  });
  return { db: { rpc } as never, calls, rpc };
}

describe("monthsBefore", () => {
  it("counts calendar months back from an instant", () => {
    expect(monthsBefore(Date.parse("2027-12-15T10:00:00Z"), 13).toISOString()).toBe("2026-11-15T10:00:00.000Z");
    expect(monthsBefore(Date.parse("2027-01-31T00:00:00Z"), 1).toISOString().slice(0, 7)).toBe("2026-12");
  });
});

describe("rollUpAndPruneUsageEvents", () => {
  const fake = useFakeClock(() => Date.parse("2027-12-15T04:00:00Z"));

  beforeEach(() => vi.clearAllMocks());

  it("rolls up each completed period in the organisation's timezone and counts them by kind", async () => {
    const { db, calls } = fakeDb({
      periods: [
        { period_kind: "day", period_start: "2027-12-12" },
        { period_kind: "week", period_start: "2027-12-05" },
        { period_kind: "month", period_start: "2027-11-01" },
      ],
      rows: [40, 25, 12],
    });

    const result = await rollUpAndPruneUsageEvents(db);

    expect(calls.find((c) => c.fn === "analytics_unrolled_periods")!.args).toEqual({ p_tz: ORG_TIMEZONE, p_now: "2027-12-15T04:00:00.000Z" });
    expect(calls.filter((c) => c.fn === "analytics_rollup_period").map((c) => c.args)).toEqual([
      { p_kind: "day", p_start: "2027-12-12", p_tz: ORG_TIMEZONE },
      { p_kind: "week", p_start: "2027-12-05", p_tz: ORG_TIMEZONE },
      { p_kind: "month", p_start: "2027-11-01", p_tz: ORG_TIMEZONE },
    ]);
    expect(result.rolledUp).toEqual({ day: 1, week: 1, month: 1, rows: 77 });
    expect(result.stoppedEarly).toBe(false);
  });

  it("removes events past the retention period, in batches, only after rolling up", async () => {
    const { db, calls } = fakeDb({ periods: [{ period_kind: "day", period_start: "2027-12-12" }], rows: [5], pruned: [5000, 120, 0] });

    const result = await rollUpAndPruneUsageEvents(db);

    const order = calls.map((c) => c.fn);
    expect(order.indexOf("analytics_prune_usage_events")).toBeGreaterThan(order.lastIndexOf("analytics_rollup_period"));
    const prunes = calls.filter((c) => c.fn === "analytics_prune_usage_events");
    expect(prunes).toHaveLength(3);
    // The cutoff is the retention constant the privacy page prints, counted back from now.
    expect(prunes[0].args).toEqual({ p_cutoff: monthsBefore(Date.parse("2027-12-15T04:00:00Z"), RETENTION.usageMonths).toISOString(), p_tz: ORG_TIMEZONE, p_limit: 5000 });
    expect(result.pruned).toBe(5120);
  });

  it("does nothing when there is nothing to roll up or remove", async () => {
    const { db } = fakeDb({});
    expect(await rollUpAndPruneUsageEvents(db)).toEqual({ rolledUp: { day: 0, week: 0, month: 0, rows: 0 }, pruned: 0, stoppedEarly: false });
  });

  it("stops at its time budget, between periods and between batches, and says so", async () => {
    const first = fakeDb({ periods: [{ period_kind: "day", period_start: "2027-12-12" }, { period_kind: "day", period_start: "2027-12-13" }], rows: [3, 3] });
    first.rpc.mockImplementationOnce(async () => {
      fake.clock.advance(USAGE_RETENTION_BUDGET_MS);
      return { data: [{ period_kind: "day", period_start: "2027-12-12" }, { period_kind: "day", period_start: "2027-12-13" }], error: null };
    });
    const early = await rollUpAndPruneUsageEvents(first.db);
    expect(early.stoppedEarly).toBe(true);
    expect(early.rolledUp.day).toBe(0);

    const second = fakeDb({ pruned: [5000, 5000] });
    second.rpc.mockImplementation(async (fn: string) => {
      if (fn === "analytics_unrolled_periods") return { data: [], error: null };
      fake.clock.advance(USAGE_RETENTION_BUDGET_MS);
      return { data: 5000, error: null };
    });
    const mid = await rollUpAndPruneUsageEvents(second.db);
    expect(mid.stoppedEarly).toBe(true);
    expect(mid.pruned).toBe(5000);
  });

  it.each(["analytics_unrolled_periods", "analytics_rollup_period", "analytics_prune_usage_events"])("fails loudly when %s fails", async (fn) => {
    const { db } = fakeDb({ periods: [{ period_kind: "day", period_start: "2027-12-12" }], error: { fn, message: "boom" } });
    await expect(rollUpAndPruneUsageEvents(db)).rejects.toThrow(new RegExp(`${fn}.*boom`));
  });
});
