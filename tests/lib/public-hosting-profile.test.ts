import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { computePublicHostingSummary, type HostedPrickleRecord } from "@/lib/hosting-stats";
import {
  fetchHostedPrickleRecords,
  mapHostedPrickleAttendanceRows,
  type HostedPrickleAttendanceRow,
} from "@/lib/hosted-prickles";
import { groupHostedPricklesIntoSlots, getMemberHostingSchedule } from "@/lib/prickle-schedule";

function record(overrides: Partial<HostedPrickleRecord>): HostedPrickleRecord {
  return {
    prickleId: "p",
    typeName: "Progress Prickle",
    startTime: "2026-01-01T14:00:00.000Z",
    earliestJoinTime: null,
    ...overrides,
  };
}

describe("computePublicHostingSummary", () => {
  it("returns an empty summary for a member who has never hosted", () => {
    expect(computePublicHostingSummary([])).toEqual({
      totalHosted: 0,
      firstHostedAt: null,
      mostRecentHostedAt: null,
      avgAttendance: null,
      typeNames: [],
    });
  });

  it("computes totals, first/most-recent dates, average attendance and types by frequency", () => {
    const summary = computePublicHostingSummary([
      record({ prickleId: "a", startTime: "2025-03-01T14:00:00.000Z", attendeeCount: 4 }),
      record({ prickleId: "b", startTime: "2024-11-05T14:00:00.000Z", attendeeCount: 6, typeName: "Sprint" }),
      record({ prickleId: "c", startTime: "2025-06-10T14:00:00.000Z", attendeeCount: 2 }),
    ]);
    expect(summary.totalHosted).toBe(3);
    expect(summary.firstHostedAt).toBe("2024-11-05T14:00:00.000Z");
    expect(summary.mostRecentHostedAt).toBe("2025-06-10T14:00:00.000Z");
    expect(summary.avgAttendance).toBe(4);
    expect(summary.typeNames).toEqual(["Progress Prickle", "Sprint"]);
  });

  it("leaves avgAttendance null when no record carries an attendee count", () => {
    expect(computePublicHostingSummary([record({})]).avgAttendance).toBeNull();
  });

  it("never exposes punctuality fields", () => {
    const summary = computePublicHostingSummary([record({ earliestJoinTime: null })]);
    expect(summary).not.toHaveProperty("onTimeRate");
    expect(summary).not.toHaveProperty("missingCount");
    expect(summary).not.toHaveProperty("lateCount");
  });
});

type Row = Record<string, unknown>;

/** Minimal chainable Supabase mock: records filter calls per table, returns canned rows once
 * per (table) query and then an empty page so pagination loops terminate. */
function makeSupabaseMock(
  tables: Record<string, Row[]>,
  rpcPages: { data: object[] | null; error: { message: string } | null }[] = []
) {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const rpc = vi.fn((fn: string, params: unknown) => {
    calls.push({ table: `rpc:${fn}`, method: "rpc", args: [params] });
    return {
      range: vi.fn((from: number, to: number) => {
        calls.push({ table: `rpc:${fn}`, method: "range", args: [from, to] });
        return Promise.resolve(rpcPages.shift() ?? { data: [], error: null });
      }),
    };
  });
  const from = vi.fn((table: string) => {
    let served = false;
    const obj: any = {};
    for (const method of ["select", "eq", "in", "gte", "lte", "order"]) {
      obj[method] = vi.fn((...args: unknown[]) => {
        calls.push({ table, method, args });
        return obj;
      });
    }
    obj.range = vi.fn(() => {
      const data = served ? [] : (tables[table] ?? []);
      served = true;
      return Promise.resolve({ data });
    });
    return obj;
  });
  return { from, rpc, calls };
}

describe("fetchHostedPrickleRecords", () => {
  const prickles = [
    { id: "p1", start_time: "2025-01-01T14:00:00.000Z", prickle_types: { name: "Progress Prickle" } },
    { id: "p2", start_time: "2025-01-08T14:00:00.000Z", prickle_types: null },
  ];

  const rpcRow = (overrides: Partial<HostedPrickleAttendanceRow>): HostedPrickleAttendanceRow => ({
    prickle_id: "p1",
    start_time: "2025-01-01T14:00:00+00:00",
    end_time: "2025-01-01T15:00:00+00:00",
    type_name: "Progress Prickle",
    host_earliest_join: "2025-01-01T14:01:00+00:00",
    attendee_count: 3,
    ...overrides,
  });

  it("gets attendee counts from the aggregating RPC, never from all-attendee rows", async () => {
    const mock = makeSupabaseMock({}, [{ data: [rpcRow({})], error: null }]);

    const records = await fetchHostedPrickleRecords(mock as any, "host", {
      now: new Date("2026-01-01T00:00:00Z"),
      includeAttendeeCounts: true,
    });

    expect(records).toEqual([
      {
        prickleId: "p1",
        typeName: "Progress Prickle",
        startTime: "2025-01-01T14:00:00+00:00",
        endTime: "2025-01-01T15:00:00+00:00",
        earliestJoinTime: "2025-01-01T14:01:00+00:00",
        attendeeCount: 3,
      },
    ]);
    expect(mock.rpc).toHaveBeenCalledWith("get_hosted_prickle_attendance", {
      p_host_id: "host",
      p_started_before: "2026-01-01T00:00:00.000Z",
    });
    expect(mock.from).not.toHaveBeenCalled();
  });

  it("pages the RPC with .range() until a short page", async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) => rpcRow({ prickle_id: `p${i}` }));
    const mock = makeSupabaseMock({}, [
      { data: fullPage, error: null },
      { data: [rpcRow({ prickle_id: "last" })], error: null },
    ]);

    const records = await fetchHostedPrickleRecords(mock as any, "host", { includeAttendeeCounts: true });

    expect(records).toHaveLength(1001);
    expect(mock.calls.filter((c) => c.method === "range").map((c) => c.args)).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("logs and throws if the RPC errors, without falling back to table reads", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const mock = makeSupabaseMock(
      { prickles: prickles.slice(0, 1), prickle_attendance: [] },
      [{ data: null, error: { message: "function does not exist" } }]
    );

    await expect(fetchHostedPrickleRecords(mock as any, "host", { includeAttendeeCounts: true })).rejects.toThrow(
      /function does not exist/
    );
    expect(errorSpy).toHaveBeenCalled();
    expect(mock.from).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("only fetches the host's own attendance and omits attendeeCount by default", async () => {
    const mock = makeSupabaseMock({ prickles: prickles.slice(0, 1), prickle_attendance: [] });
    const records = await fetchHostedPrickleRecords(mock as any, "host");
    expect(records[0]).not.toHaveProperty("attendeeCount");
    expect(mock.calls).toContainEqual({ table: "prickle_attendance", method: "eq", args: ["member_id", "host"] });
  });

  it("skips the attendance query entirely for a member who has never hosted", async () => {
    const mock = makeSupabaseMock({ prickles: [] });
    expect(await fetchHostedPrickleRecords(mock as any, "host")).toEqual([]);
    expect(mock.from).not.toHaveBeenCalledWith("prickle_attendance");
  });

  it("host-only path never calls the RPC and scopes attendance to the host", async () => {
    const mock = makeSupabaseMock({
      prickles: prickles.slice(0, 1),
      prickle_attendance: [
        { prickle_id: "p1", join_time: "2025-01-01T14:10:00.000Z" },
        { prickle_id: "p1", join_time: "2025-01-01T14:01:00.000Z" },
      ],
    });
    const [r] = await fetchHostedPrickleRecords(mock as any, "host");
    expect(r.earliestJoinTime).toBe("2025-01-01T14:01:00.000Z");
    expect(mock.rpc).not.toHaveBeenCalled();
  });
});

describe("mapHostedPrickleAttendanceRows", () => {
  it("defaults a missing type name to Prickle and a null count to 0", () => {
    const [r] = mapHostedPrickleAttendanceRows([
      {
        prickle_id: "p",
        start_time: "2025-01-01T14:00:00+00:00",
        end_time: "2025-01-01T15:00:00+00:00",
        type_name: null,
        host_earliest_join: null,
        attendee_count: null,
      },
    ]);
    expect(r).toEqual({
      prickleId: "p",
      typeName: "Prickle",
      startTime: "2025-01-01T14:00:00+00:00",
      endTime: "2025-01-01T15:00:00+00:00",
      earliestJoinTime: null,
      attendeeCount: 0,
    });
  });
});

describe("groupHostedPricklesIntoSlots", () => {
  const TZ = "America/New_York";

  it("groups a weekly slot, keeps the earliest occurrence, and orders by day then time", () => {
    const slots = groupHostedPricklesIntoSlots(
      [
        // Tuesdays 10:00 ET (EDT, UTC-4)
        { id: "tue2", typeId: "t1", typeName: "Progress Prickle", startTime: "2026-10-06T14:00:00.000Z" },
        { id: "tue1", typeId: "t1", typeName: "Progress Prickle", startTime: "2026-09-29T14:00:00.000Z" },
        // Monday 18:30 ET one-off
        { id: "mon", typeId: "t2", typeName: "Sprint", startTime: "2026-10-05T22:30:00.000Z" },
      ],
      TZ
    );

    expect(slots.map((s) => [s.dayOfWeek, s.typeName, s.nextOccurrenceId, s.upcomingCount])).toEqual([
      ["Monday", "Sprint", "mon", 1],
      ["Tuesday", "Progress Prickle", "tue1", 2],
    ]);
    expect(slots[1].timeLabel).toBe("10:00 AM EDT");
  });

  it("renders the slot in the viewer's timezone, which can shift the day", () => {
    const [slot] = groupHostedPricklesIntoSlots(
      [{ id: "p", typeId: "t1", typeName: "Night Owl", startTime: "2026-09-30T03:00:00.000Z" }],
      "Australia/Sydney"
    );
    expect(slot.dayOfWeek).toBe("Wednesday");
    expect(slot.timeLabel).toMatch(/^1:00 PM/);
  });

  it("keeps different prickle types at the same time as separate slots", () => {
    const slots = groupHostedPricklesIntoSlots(
      [
        { id: "a", typeId: "t1", typeName: "A", startTime: "2026-09-29T14:00:00.000Z" },
        { id: "b", typeId: "t2", typeName: "B", startTime: "2026-09-29T14:00:00.000Z" },
      ],
      TZ
    );
    expect(slots).toHaveLength(2);
  });
});

describe("getMemberHostingSchedule", () => {
  it("scopes to the host's upcoming prickles within the window", async () => {
    const mock = makeSupabaseMock({
      prickles: [{ id: "p1", type_id: "t1", start_time: "2026-09-29T14:00:00.000Z", prickle_types: [{ name: "PP" }] }],
    });
    const now = new Date("2026-09-26T00:00:00.000Z");
    const slots = await getMemberHostingSchedule(mock as any, "host", now, "America/New_York", 35);

    expect(slots).toHaveLength(1);
    expect(slots[0].typeName).toBe("PP");
    expect(mock.calls).toContainEqual({ table: "prickles", method: "eq", args: ["host", "host"] });
    expect(mock.calls).toContainEqual({ table: "prickles", method: "gte", args: ["start_time", now.toISOString()] });
    expect(mock.calls).toContainEqual({
      table: "prickles",
      method: "lte",
      args: ["start_time", "2026-10-31T00:00:00.000Z"],
    });
  });
});
