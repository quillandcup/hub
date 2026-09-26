import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { getPrickleScheduleOverview } from "@/lib/prickle-schedule";

type Row = Record<string, unknown>;

/** Minimal chainable Supabase mock: records filter calls per table and returns the canned rows
 * for that table (fewer than a full page, so the pagination loop stops after one call). */
function makeSupabaseMock(tables: Record<string, Row[]>) {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const from = vi.fn((table: string) => {
    const obj: any = {};
    for (const method of ["select", "eq", "in", "gte", "lte", "order"]) {
      obj[method] = vi.fn((...args: unknown[]) => {
        calls.push({ table, method, args });
        return obj;
      });
    }
    obj.range = vi.fn(() => Promise.resolve({ data: tables[table] ?? [] }));
    return obj;
  });
  return { from, calls };
}

// Wednesday 2026-09-23, noon ET.
const NOW = new Date("2026-09-23T16:00:00.000Z");
const TZ = "America/New_York";
const HOST_A = { id: "host-a", name: "Pat Legalname", display_name: "Penny Quill" };
const HOST_B = { id: "host-b", name: "Robin Example", display_name: null };
const SPRINT = { name: "Morning Sprint" };
const DEEP = { name: "Deep Work" };

function prickle(id: string, start: string, typeId: string | null, type: unknown, host: unknown): Row {
  const end = new Date(new Date(start).getTime() + 60 * 60 * 1000).toISOString();
  return { id, type_id: typeId, start_time: start, end_time: end, prickle_types: type, host };
}

// Monday 10am ET slot: two past weeks + next week. Tuesday 2pm ET "Deep Work": past only (this week).
const PRICKLES: Row[] = [
  prickle("sprint-past-2", "2026-09-14T14:00:00.000Z", "t-sprint", SPRINT, HOST_A),
  prickle("deep-past", "2026-09-22T18:00:00.000Z", "t-deep", [DEEP], [HOST_B]),
  prickle("sprint-past-1", "2026-09-21T14:00:00.000Z", "t-sprint", SPRINT, null),
  prickle("sprint-next", "2026-09-28T14:00:00.000Z", "t-sprint", SPRINT, HOST_B),
];

async function load(prickles: Row[] = PRICKLES) {
  const supabase = makeSupabaseMock({
    prickles,
    prickle_attendance: [
      { prickle_id: "sprint-past-2", member_id: "m1" },
      { prickle_id: "sprint-past-2", member_id: "m2" },
      { prickle_id: "sprint-past-1", member_id: "m1" },
      { prickle_id: "sprint-past-1", member_id: "m1" },
    ],
  });
  const overview = await getPrickleScheduleOverview(supabase as any, NOW, TZ, 14, 21);
  return { overview, supabase };
}

describe("getPrickleScheduleOverview", () => {
  it("queries prickles across the whole lookback + upcoming window", async () => {
    const { supabase } = await load();
    const prickleCalls = supabase.calls.filter((c) => c.table === "prickles");
    expect(prickleCalls).toContainEqual({ table: "prickles", method: "gte", args: ["start_time", "2026-09-09T16:00:00.000Z"] });
    expect(prickleCalls).toContainEqual({ table: "prickles", method: "lte", args: ["start_time", "2026-10-14T16:00:00.000Z"] });
  });

  it("returns past AND upcoming prickles in instances, not just upcoming ones", async () => {
    const { overview } = await load();
    expect(overview.instances.map((i) => i.id).sort()).toEqual(
      ["deep-past", "sprint-next", "sprint-past-1", "sprint-past-2"].sort()
    );
  });

  it("maps instance fields (type name, host display name, times), unwrapping embedded arrays", async () => {
    const { overview } = await load();
    const byId = new Map(overview.instances.map((i) => [i.id, i]));

    expect(byId.get("sprint-past-2")).toEqual({
      id: "sprint-past-2",
      typeId: "t-sprint",
      typeName: "Morning Sprint",
      hostId: "host-a",
      hostName: "Penny Quill",
      startTime: "2026-09-14T14:00:00.000Z",
      endTime: "2026-09-14T15:00:00.000Z",
    });
    // Array-wrapped embeds, and a host with no pen name falls back to their name.
    expect(byId.get("deep-past")).toMatchObject({ typeName: "Deep Work", hostId: "host-b", hostName: "Robin Example" });
    // No host attached to this occurrence.
    expect(byId.get("sprint-past-1")).toMatchObject({ hostId: null, hostName: null });
  });

  it("falls back to 'Prickle' when an instance has no type", async () => {
    const { overview } = await load([prickle("untyped", "2026-09-22T14:00:00.000Z", null, null, null)]);
    expect(overview.instances[0]).toMatchObject({ typeId: null, typeName: "Prickle" });
  });

  it("only builds schedule rows for slots with an upcoming occurrence", async () => {
    const { overview } = await load();
    // "Deep Work" only has a past occurrence, so it is in instances but not rows.
    expect(overview.rows).toHaveLength(1);
    const [row] = overview.rows;
    expect(row).toMatchObject({
      typeId: "t-sprint",
      typeName: "Morning Sprint",
      dayOfWeek: "Monday",
      nextOccurrenceId: "sprint-next",
      nextOccurrenceStart: "2026-09-28T14:00:00.000Z",
      sessionCount: 2,
      avgAttendance: 1.5,
      // Representative host comes from history (host-a hosted once, the other past week had none).
      hostId: "host-a",
      hostName: "Penny Quill",
    });
  });

  it("returns no rows but still returns instances when every prickle is in the past", async () => {
    const { overview } = await load(PRICKLES.filter((p) => p.id !== "sprint-next"));
    expect(overview.rows).toEqual([]);
    expect(overview.instances).toHaveLength(3);
  });
});
