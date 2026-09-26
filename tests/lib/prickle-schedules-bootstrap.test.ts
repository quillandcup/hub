import { describe, it, expect, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { bootstrapMonthFromCalendar } from "@/lib/prickle-schedules";

/**
 * Unit tests for bootstrapMonthFromCalendar against a tiny in-memory stand-in
 * for the Supabase query builder (only the filters this function uses). The
 * HTTP route is covered end-to-end in tests/api/prickle-schedules/bootstrap.test.ts;
 * these cover backporting an arbitrary (next) month, dry runs, and what happens
 * to rows that already exist in the month.
 */

type Row = Record<string, any>;

function getPath(row: Row, path: string): any {
  return path.split(".").reduce((v, k) => (v == null ? v : v[k]), row);
}

function fakeSupabase(tables: Record<string, Row[]>) {
  let nextId = 1;
  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    let op: "select" | "insert" | "update" = "select";
    let payload: any;
    const builder: any = {
      select: () => builder,
      order: () => builder,
      eq: (c: string, v: any) => (filters.push((r) => getPath(r, c) === v), builder),
      neq: (c: string, v: any) => (filters.push((r) => getPath(r, c) !== v), builder),
      is: (c: string, v: any) => (filters.push((r) => (getPath(r, c) ?? null) === v), builder),
      not: (c: string, _op: string, v: any) => (filters.push((r) => (getPath(r, c) ?? null) !== v), builder),
      in: (c: string, vs: any[]) => (filters.push((r) => vs.includes(getPath(r, c))), builder),
      gte: (c: string, v: string) => (filters.push((r) => getPath(r, c) >= v), builder),
      lt: (c: string, v: string) => (filters.push((r) => getPath(r, c) < v), builder),
      insert: (rows: Row[]) => ((op = "insert"), (payload = rows), builder),
      update: (patch: Row) => ((op = "update"), (payload = patch), builder),
      then: (resolve: (v: unknown) => void) => {
        const rows = (tables[table] ??= []);
        if (op === "insert") {
          for (const r of payload) rows.push({ id: `new-${nextId++}`, deleted_at: null, ...r });
          return resolve({ data: null, error: null });
        }
        const matched = rows.filter((r) => filters.every((f) => f(r)));
        if (op === "update") {
          for (const r of matched) Object.assign(r, payload);
          return resolve({ data: null, error: null });
        }
        return resolve({ data: matched.map((r) => ({ ...r })), error: null });
      },
    };
    return builder;
  };
  return { from } as unknown as SupabaseClient;
}

// October 2026: Thursdays are 1, 8, 15, 22, 29; Mondays are 5, 12, 19, 26; Tuesdays 6, 13, 20, 27.
const OCTOBER = "2026-10-01";
const NOVEMBER = "2026-11-01";
const HOSTED = { requires_host: true };

// 7pm ET (EDT, UTC-4) on the given October day.
function prickle(host: string, type: string, day: number, requiresHost = HOSTED) {
  const dd = String(day).padStart(2, "0");
  return {
    host,
    type_id: type,
    source: "calendar",
    start_time: `2026-10-${dd}T23:00:00.000Z`,
    prickle_types: requiresHost,
  };
}

function schedule(overrides: Row): Row {
  return {
    id: `sched-${Math.random().toString(36).slice(2)}`,
    type_id: "type-a",
    month: OCTOBER,
    recurrence_type: "weekly",
    week_of_month: null,
    recurrence_anchor_date: null,
    start_time_local: "19:00",
    timezone: "America/New_York",
    notes: null,
    deleted_at: null,
    carried_forward_from: null,
    ...overrides,
  };
}

describe("bootstrapMonthFromCalendar", () => {
  let tables: Record<string, Row[]>;

  beforeEach(() => {
    tables = {
      prickles: [
        // host-1: every Thursday -> weekly (already has a proposed carried-forward row)
        ...[1, 8, 15, 22, 29].map((d) => prickle("host-1", "type-a", d)),
        // host-2: every Monday -> weekly (no row yet)
        ...[5, 12, 19, 26].map((d) => prickle("host-2", "type-a", d)),
        // host-3: 2nd Tuesday only -> monthly week 2 (admin already declined it)
        prickle("host-3", "type-a", 13),
        // Doesn't require a host -> ignored
        prickle("host-4", "type-b", 7, { requires_host: false }),
      ],
      prickle_schedules: [
        schedule({ id: "proposed-thu", host_id: "host-1", day_of_week: 4, status: "proposed" }),
        schedule({ id: "declined-tue", host_id: "host-3", recurrence_type: "monthly", day_of_week: 2, week_of_month: 2, status: "declined" }),
        // host-5's Friday slot isn't on October's calendar any more
        schedule({ id: "stale-fri", host_id: "host-5", day_of_week: 5, status: "proposed" }),
      ],
    };
  });

  const october = () => tables.prickle_schedules.filter((r) => r.month === OCTOBER);

  it("dry run reports what would change without writing anything", async () => {
    const before = JSON.stringify(tables);
    const result = await bootstrapMonthFromCalendar(fakeSupabase(tables), OCTOBER, "admin-1", { dryRun: true });

    expect(result).toEqual({
      created: 1,
      skippedExisting: 2,
      matchingProposed: 1,
      confirmedExisting: 0,
      unmatchedExisting: 1,
      copiedToNextMonth: 0,
      dryRun: true,
    });
    expect(JSON.stringify(tables)).toBe(before);
  });

  it("backports next month additively: inserts new confirmed slots, leaves existing rows untouched by default", async () => {
    const result = await bootstrapMonthFromCalendar(fakeSupabase(tables), OCTOBER, "admin-1");

    expect(result.created).toBe(1);
    expect(result.confirmedExisting).toBe(0);
    const created = october().find((r) => r.host_id === "host-2")!;
    expect(created).toMatchObject({
      recurrence_type: "weekly",
      day_of_week: 1,
      start_time_local: "19:00",
      status: "confirmed",
      confirmed_by: "admin-1",
    });

    const byId = Object.fromEntries(october().map((r) => [r.id, r]));
    expect(byId["proposed-thu"].status).toBe("proposed");
    expect(byId["declined-tue"].status).toBe("declined");
    expect(byId["stale-fri"]).toMatchObject({ status: "proposed", deleted_at: null });
    expect(october()).toHaveLength(4);
  });

  it("confirms matching proposed rows only when asked, and never overrides a declined slot", async () => {
    const result = await bootstrapMonthFromCalendar(fakeSupabase(tables), OCTOBER, "admin-1", {
      confirmMatchingProposed: true,
    });

    expect(result.confirmedExisting).toBe(1);
    const byId = Object.fromEntries(october().map((r) => [r.id, r]));
    expect(byId["proposed-thu"]).toMatchObject({ status: "confirmed", confirmed_by: "admin-1" });
    expect(byId["declined-tue"].status).toBe("declined");
    expect(byId["stale-fri"].status).toBe("proposed");
  });

  it("seeds the following month from October's confirmed rows", async () => {
    const result = await bootstrapMonthFromCalendar(fakeSupabase(tables), OCTOBER, "admin-1");

    const november = tables.prickle_schedules.filter((r) => r.month === NOVEMBER);
    expect(result.copiedToNextMonth).toBe(1);
    expect(november).toHaveLength(1);
    expect(november[0]).toMatchObject({ host_id: "host-2", status: "proposed" });
  });

  it("is idempotent: a second run creates and confirms nothing new", async () => {
    await bootstrapMonthFromCalendar(fakeSupabase(tables), OCTOBER, "admin-1", { confirmMatchingProposed: true });
    const count = tables.prickle_schedules.length;

    const again = await bootstrapMonthFromCalendar(fakeSupabase(tables), OCTOBER, "admin-1", {
      confirmMatchingProposed: true,
    });

    expect(again).toMatchObject({ created: 0, skippedExisting: 3, matchingProposed: 0, confirmedExisting: 0, copiedToNextMonth: 0 });
    expect(tables.prickle_schedules).toHaveLength(count);
  });
});
