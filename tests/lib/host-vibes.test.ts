import { afterEach, describe, expect, it, vi } from "vitest";
import { getHostVibeTypes } from "@/lib/host-vibes";

const type = (id: string) => ({ id, name: id });
const prickle = (id: string, start_time: string, host = "new-host") => ({ id, type_id: id, prickle_types: type(id), start_time, host });
const signup = (id: string, month: string, status = "confirmed", deleted_at: string | null = null, host_id = "new-host") =>
  ({ id, type_id: id, prickle_types: [type(id)], month, status, deleted_at, host_id });

function database(tables: Record<string, Record<string, any>[]>) {
  return { from: (table: string) => {
    let rows = tables[table] ?? [];
    const query: any = {
      select: () => query,
      eq: (key: string, value: unknown) => { rows = rows.filter((r) => r[key] === value); return query; },
      gte: (key: string, value: string) => { rows = rows.filter((r) => r[key] >= value); return query; },
      in: (key: string, values: unknown[]) => { rows = rows.filter((r) => values.includes(r[key])); return query; },
      is: (key: string, value: unknown) => { rows = rows.filter((r) => r[key] === value); return query; },
      order: () => query,
      range: (start: number, end: number) => Promise.resolve({ data: rows.slice(start, end + 1) }),
    };
    return query;
  } } as never;
}

afterEach(() => vi.useRealTimers());

describe("host vibe eligibility", () => {
  it("includes new hosts' current and future signups before any prickles exist", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));
    const db = database({ prickle_schedules: [
      signup("current", "2026-10-01"),
      signup("proposed", "2026-11-01", "proposed"),
      signup("future", "2027-01-01"),
      signup("past", "2026-09-01"),
      signup("declined", "2026-11-01", "declined"),
      signup("withdrawn", "2026-11-01", "confirmed", "2026-10-01"),
      signup("other-member", "2026-11-01", "confirmed", null, "someone-else"),
    ] });
    expect([...await getHostVibeTypes(db, "new-host")]).toEqual([
      ["current", "current"], ["proposed", "proposed"], ["future", "future"],
    ]);
  });

  it("keeps recent and upcoming hosted types, deduplicated with signups", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));
    const db = database({
      prickles: [prickle("recent", "2026-09-01"), prickle("upcoming", "2026-11-01"),
        prickle("old", "2026-01-01"), prickle("other", "2026-11-01", "someone-else")],
      prickle_schedules: [signup("upcoming", "2026-11-01")],
    });
    expect([...await getHostVibeTypes(db, "new-host")]).toEqual([["recent", "recent"], ["upcoming", "upcoming"]]);
  });

  it("paginates beyond the database row limit", async () => {
    const db = database({ prickle_schedules: Array.from({ length: 1001 }, (_, i) => signup(`type-${i}`, "2099-01-01")) });
    expect((await getHostVibeTypes(db, "new-host")).size).toBe(1001);
  });
});
