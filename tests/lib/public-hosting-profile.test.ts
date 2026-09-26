import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { computePublicHostingSummary, type HostedPrickleRecord } from "@/lib/hosting-stats";
import { fetchHostedPrickleRecords } from "@/lib/hosted-prickles";
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
function makeSupabaseMock(tables: Record<string, Row[]>) {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
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
  return { from, calls };
}

describe("fetchHostedPrickleRecords", () => {
  const prickles = [
    { id: "p1", start_time: "2025-01-01T14:00:00.000Z", prickle_types: { name: "Progress Prickle" } },
    { id: "p2", start_time: "2025-01-08T14:00:00.000Z", prickle_types: null },
  ];

  it("counts distinct attendees per prickle and the host's earliest join when asked", async () => {
    const mock = makeSupabaseMock({
      prickles,
      prickle_attendance: [
        { prickle_id: "p1", member_id: "host", join_time: "2025-01-01T14:10:00.000Z" },
        { prickle_id: "p1", member_id: "host", join_time: "2025-01-01T14:01:00.000Z" },
        { prickle_id: "p1", member_id: "m2", join_time: "2025-01-01T14:00:00.000Z" },
        { prickle_id: "p1", member_id: "m2", join_time: "2025-01-01T15:00:00.000Z" },
        { prickle_id: "p1", member_id: "m3", join_time: "2025-01-01T14:02:00.000Z" },
      ],
    });

    const records = await fetchHostedPrickleRecords(mock as any, "host", {
      now: new Date("2026-01-01T00:00:00Z"),
      includeAttendeeCounts: true,
    });

    expect(records).toEqual([
      {
        prickleId: "p1",
        typeName: "Progress Prickle",
        startTime: "2025-01-01T14:00:00.000Z",
        earliestJoinTime: "2025-01-01T14:01:00.000Z",
        attendeeCount: 3,
      },
      {
        prickleId: "p2",
        typeName: "Prickle",
        startTime: "2025-01-08T14:00:00.000Z",
        earliestJoinTime: null,
        attendeeCount: 0,
      },
    ]);
    // All attendees, not just the host, when counting.
    expect(mock.calls).not.toContainEqual({ table: "prickle_attendance", method: "eq", args: ["member_id", "host"] });
    expect(mock.calls).toContainEqual({ table: "prickles", method: "eq", args: ["host", "host"] });
    expect(mock.calls).toContainEqual({
      table: "prickles",
      method: "lte",
      args: ["start_time", "2026-01-01T00:00:00.000Z"],
    });
  });

  it("only fetches the host's own attendance and omits attendeeCount by default", async () => {
    const mock = makeSupabaseMock({ prickles: prickles.slice(0, 1), prickle_attendance: [] });
    const records = await fetchHostedPrickleRecords(mock as any, "host");
    expect(records[0]).not.toHaveProperty("attendeeCount");
    expect(mock.calls).toContainEqual({ table: "prickle_attendance", method: "eq", args: ["member_id", "host"] });
  });

  it("skips the attendance query entirely for a member who has never hosted", async () => {
    const mock = makeSupabaseMock({ prickles: [] });
    expect(await fetchHostedPrickleRecords(mock as any, "host", { includeAttendeeCounts: true })).toEqual([]);
    expect(mock.from).not.toHaveBeenCalledWith("prickle_attendance");
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
