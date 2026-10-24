import { describe, it, expect, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import type { Prickle } from "@/lib/data/prickles";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
// Prickles and attendance come from their repositories; this test runs them in memory.
let dataset = new InMemoryDataset();
vi.mock("@/lib/data/repos", async () => {
  const { createInMemoryRepos } = await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos");
  return { createRepos: () => createInMemoryRepos(dataset) };
});

import { getPrickleScheduleOverview } from "@/lib/prickle-schedule";

// Wednesday 2026-09-23, noon ET.
const NOW = new Date("2026-09-23T16:00:00.000Z");
const TZ = "America/New_York";
const HOST_A = { id: "host-a", name: "Pat Legalname", displayName: "Penny Quill" };
const HOST_B = { id: "host-b", name: "Robin Example", displayName: null };
const SPRINT_TYPE = { id: "t-sprint", name: "Morning Sprint", normalizedName: "morning-sprint", purpose: "writing", requiresHost: true, soloTaskFriendly: false };
const DEEP_TYPE = { id: "t-deep", name: "Deep Work", normalizedName: "deep-work", purpose: "writing", requiresHost: true, soloTaskFriendly: false };

function prickle(id: string, start: string, typeId: string | null, hostId: string | null): Prickle {
  const end = new Date(new Date(start).getTime() + 60 * 60 * 1000).toISOString();
  return { id, typeId, hostId, title: null, startTime: start, endTime: end, source: "calendar", calendarEventId: null };
}

// Monday 10am ET slot: two past weeks + next week. Tuesday 2pm ET "Deep Work": past only (this week).
const PRICKLES: Prickle[] = [
  prickle("sprint-past-2", "2026-09-14T14:00:00.000Z", "t-sprint", "host-a"),
  prickle("deep-past", "2026-09-22T18:00:00.000Z", "t-deep", "host-b"),
  prickle("sprint-past-1", "2026-09-21T14:00:00.000Z", "t-sprint", null),
  prickle("sprint-next", "2026-09-28T14:00:00.000Z", "t-sprint", "host-b"),
];
const attendanceRow = (id: string, prickleId: string, memberId: string) => ({
  id,
  prickleId,
  memberId,
  joinTime: "2026-09-14T14:00:00.000Z",
  leaveTime: "2026-09-14T15:00:00.000Z",
});

async function load(prickles: Prickle[] = PRICKLES) {
  dataset = new InMemoryDataset({
    members: [HOST_A, HOST_B],
    prickleTypes: [SPRINT_TYPE, DEEP_TYPE],
    prickles,
    attendance: [
      attendanceRow("a1", "sprint-past-2", "m1"),
      attendanceRow("a2", "sprint-past-2", "m2"),
      attendanceRow("a3", "sprint-past-1", "m1"),
      attendanceRow("a4", "sprint-past-1", "m1"),
    ],
  });
  const overview = await getPrickleScheduleOverview({} as never, NOW, TZ, 14, 21);
  return { overview };
}

describe("getPrickleScheduleOverview", () => {
  it("covers the whole lookback + upcoming window, and nothing outside it", async () => {
    const { overview } = await load([
      ...PRICKLES,
      prickle("too-old", "2026-09-09T15:59:59.000Z", "t-sprint", null), // just before the lookback starts
      prickle("at-lookback-start", "2026-09-09T16:00:00.000Z", "t-sprint", null),
      prickle("at-window-end", "2026-10-14T16:00:00.000Z", "t-sprint", null),
      prickle("too-far", "2026-10-14T16:00:01.000Z", "t-sprint", null),
    ]);

    const ids = overview.instances.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(["at-lookback-start", "at-window-end"]));
    expect(ids).not.toContain("too-old");
    expect(ids).not.toContain("too-far");
  });

  it("returns past AND upcoming prickles in instances, not just upcoming ones", async () => {
    const { overview } = await load();
    expect(overview.instances.map((i) => i.id).sort()).toEqual(
      ["deep-past", "sprint-next", "sprint-past-1", "sprint-past-2"].sort()
    );
  });

  it("maps instance fields (type name, host display name, times)", async () => {
    const { overview } = await load();
    const byId = new Map(overview.instances.map((i) => [i.id, i]));

    expect(byId.get("sprint-past-2")).toEqual({
      id: "sprint-past-2",
      // Mon 10:00 AM EDT -- the same key as that slot's schedule row, so the calendar can map a
      // clicked occurrence to its recurring slot (commit picking).
      seriesKey: "t-sprint:1-10:00",
      typeId: "t-sprint",
      typeName: "Morning Sprint",
      hostId: "host-a",
      hostName: "Penny Quill",
      startTime: "2026-09-14T14:00:00.000Z",
      endTime: "2026-09-14T15:00:00.000Z",
    });
    // A host with no pen name falls back to their name.
    expect(byId.get("deep-past")).toMatchObject({ typeName: "Deep Work", hostId: "host-b", hostName: "Robin Example" });
    // No host attached to this occurrence.
    expect(byId.get("sprint-past-1")).toMatchObject({ hostId: null, hostName: null });
  });

  it("falls back to 'Prickle' when an instance has no type", async () => {
    const { overview } = await load([prickle("untyped", "2026-09-22T14:00:00.000Z", null, null)]);
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
