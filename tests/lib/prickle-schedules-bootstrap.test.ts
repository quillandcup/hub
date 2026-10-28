import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { InMemoryDataset } from "@/lib/data/in-memory";
import type { ScheduleRow } from "@/lib/data/prickle-schedules";
import { createInMemoryRepos } from "@/lib/data/repos";
import { bootstrapMonthFromCalendar } from "@/lib/prickle-schedules";

// Prickles and schedules come from their repositories, in memory here.
let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

/**
 * Unit tests for bootstrapMonthFromCalendar against the in-memory repositories. The HTTP route is
 * covered end-to-end in tests/api/prickle-schedules/bootstrap.test.ts; these cover backporting an
 * arbitrary (next) month, dry runs, and what happens to rows that already exist in the month.
 */

const supabase = {} as SupabaseClient;

// October 2026: Thursdays are 1, 8, 15, 22, 29; Mondays are 5, 12, 19, 26; Tuesdays 6, 13, 20, 27.
const OCTOBER = "2026-10-01";
const NOVEMBER = "2026-11-01";
// type-a takes a host; type-b doesn't.
const TYPES = [
  { id: "type-a", name: "Type A", normalizedName: "type-a", purpose: "writing", requiresHost: true, soloTaskFriendly: false, listedInEvents: false, announcedPublicly: false, guestsAllowed: false },
  { id: "type-b", name: "Type B", normalizedName: "type-b", purpose: "writing", requiresHost: false, soloTaskFriendly: false, listedInEvents: false, announcedPublicly: false, guestsAllowed: false },
];
const HOSTS = [1, 2, 3, 4, 5].map((n) => ({ id: `host-${n}`, name: `Host ${n}` }));

// 7pm ET (EDT, UTC-4) on the given October day.
let prickleCount = 0;
function prickle(host: string, type: string, day: number) {
  const dd = String(day).padStart(2, "0");
  return {
    id: `prkl_${String(++prickleCount).padStart(12, "A")}`,
    typeId: type,
    hostId: host,
    title: null,
    source: "calendar",
    startTime: `2026-10-${dd}T23:00:00.000Z`,
    endTime: `2026-10-${dd}T23:00:00.000Z`,
    calendarEventId: null,
  };
}

function schedule(overrides: Partial<ScheduleRow> & Pick<ScheduleRow, "id" | "host_id" | "status">): ScheduleRow {
  return {
    type_id: "type-a",
    month: OCTOBER,
    recurrence_type: "weekly",
    day_of_week: null,
    week_of_month: null,
    recurrence_anchor_date: null,
    event_date: null,
    start_time_local: "19:00",
    timezone: "America/New_York",
    notes: null,
    deleted_at: null,
    deleted_by: null,
    carried_forward_from: null,
    confirmed_by: null,
    confirmed_at: null,
    updated_by: null,
    updated_at: "2026-09-01T00:00:00Z",
    created_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

describe("bootstrapMonthFromCalendar", () => {
  let data: InMemoryDataset;

  beforeEach(() => {
    const prickles = [
      // host-1: every Thursday -> weekly (already has a proposed carried-forward row)
      ...[1, 8, 15, 22, 29].map((d) => prickle("host-1", "type-a", d)),
      // host-2: every Monday -> weekly (no row yet)
      ...[5, 12, 19, 26].map((d) => prickle("host-2", "type-a", d)),
      // host-3: 2nd Tuesday only -> monthly week 2 (admin already declined it)
      prickle("host-3", "type-a", 13),
      // Doesn't require a host -> ignored
      prickle("host-4", "type-b", 7),
    ];
    data = new InMemoryDataset({
      members: HOSTS,
      prickleTypes: TYPES,
      prickles,
      prickleSchedules: [
        schedule({ id: "proposed-thu", host_id: "host-1", day_of_week: 4, status: "proposed" }),
        schedule({ id: "declined-tue", host_id: "host-3", recurrence_type: "monthly", day_of_week: 2, week_of_month: 2, status: "declined" }),
        // host-5's Friday slot isn't on October's calendar any more
        schedule({ id: "stale-fri", host_id: "host-5", day_of_week: 5, status: "proposed" }),
      ],
    });
    repos = createInMemoryRepos(data);
  });

  const october = () => data.prickleSchedules.filter((r) => r.month === OCTOBER);

  it("dry run reports what would change without writing anything", async () => {
    const before = JSON.stringify(data.prickleSchedules);
    const result = await bootstrapMonthFromCalendar(supabase, OCTOBER, "admin-1", { dryRun: true });

    expect(result).toEqual({
      created: 1,
      skippedExisting: 2,
      matchingProposed: 1,
      confirmedExisting: 0,
      unmatchedExisting: 1,
      copiedToNextMonth: 0,
      dryRun: true,
    });
    expect(JSON.stringify(data.prickleSchedules)).toBe(before);
  });

  it("backports next month additively: inserts new confirmed slots, leaves existing rows untouched by default", async () => {
    const result = await bootstrapMonthFromCalendar(supabase, OCTOBER, "admin-1");

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
    const result = await bootstrapMonthFromCalendar(supabase, OCTOBER, "admin-1", {
      confirmMatchingProposed: true,
    });

    expect(result.confirmedExisting).toBe(1);
    const byId = Object.fromEntries(october().map((r) => [r.id, r]));
    expect(byId["proposed-thu"]).toMatchObject({ status: "confirmed", confirmed_by: "admin-1" });
    expect(byId["declined-tue"].status).toBe("declined");
    expect(byId["stale-fri"].status).toBe("proposed");
  });

  it("seeds the following month from October's confirmed rows", async () => {
    const result = await bootstrapMonthFromCalendar(supabase, OCTOBER, "admin-1");

    const november = data.prickleSchedules.filter((r) => r.month === NOVEMBER);
    expect(result.copiedToNextMonth).toBe(1);
    expect(november).toHaveLength(1);
    expect(november[0]).toMatchObject({ host_id: "host-2", status: "proposed" });
  });

  it("is idempotent: a second run creates and confirms nothing new", async () => {
    await bootstrapMonthFromCalendar(supabase, OCTOBER, "admin-1", { confirmMatchingProposed: true });
    const count = data.prickleSchedules.length;

    const again = await bootstrapMonthFromCalendar(supabase, OCTOBER, "admin-1", {
      confirmMatchingProposed: true,
    });

    expect(again).toMatchObject({ created: 0, skippedExisting: 3, matchingProposed: 0, confirmedExisting: 0, copiedToNextMonth: 0 });
    expect(data.prickleSchedules).toHaveLength(count);
  });

  it("fails when the schedules can't be read, instead of treating the month as empty", async () => {
    repos = {
      ...repos,
      prickleSchedules: Object.assign(Object.create(repos.prickleSchedules), {
        liveInMonth: async () => {
          throw new Error("db down");
        },
      }),
    };

    await expect(bootstrapMonthFromCalendar(supabase, OCTOBER, "admin-1")).rejects.toThrow("db down");
  });
});
