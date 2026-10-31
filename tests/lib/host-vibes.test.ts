import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { getHostVibeTypes } from "@/lib/host-vibes";

let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

const HOST = "mbr_AAAAAAAAAAA1";
const OTHER = "mbr_AAAAAAAAAAA2";
const typeId = (name: string) => `ptyp_${name.padEnd(12, "A").slice(0, 12)}`;
const type = (name: string) => ({
  id: typeId(name), name, normalizedName: name, purpose: "writing", requiresHost: true, soloTaskFriendly: false, listedInEvents: false, announcedPublicly: false, guestsAllowed: false,
});
const prickle = (name: string, start: string, hostId = HOST) => ({
  id: `prkl_${name.padEnd(12, "A").slice(0, 12)}`, typeId: typeId(name), hostId, title: null, startTime: start, endTime: start, source: "calendar", calendarEventId: null,
});
const signup = (name: string, month: string, status = "confirmed", deleted_at: string | null = null, host_id = HOST) =>
  ({
    id: `psch_${name.padEnd(12, "A").slice(0, 12)}`, host_id, type_id: typeId(name), month, status, deleted_at, recurrence_type: "weekly", start_time_local: "09:00", timezone: "America/New_York",
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
  });

function database(names: string[], prickles: object[], schedules: object[]) {
  repos = createInMemoryRepos(
    new InMemoryDataset({
      members: [{ id: HOST, name: "Ada Example" }, { id: OTHER, name: "Bea Example" }],
      prickleTypes: names.map(type),
      prickles: prickles as never,
      prickleSchedules: schedules as never,
    })
  );
  return {} as never;
}

afterEach(() => vi.useRealTimers());

describe("host vibe eligibility", () => {
  it("includes new hosts' current and future signups before any prickles exist", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));
    const db = database(["current", "proposed", "future", "past", "declined", "withdrawn", "other"], [], [
      signup("current", "2026-10-01"),
      signup("proposed", "2026-11-01", "proposed"),
      signup("future", "2027-01-01"),
      signup("past", "2026-09-01"),
      signup("declined", "2026-11-01", "declined"),
      signup("withdrawn", "2026-11-01", "confirmed", "2026-10-01"),
      signup("other", "2026-11-01", "confirmed", null, OTHER),
    ]);
    expect([...(await getHostVibeTypes(db, HOST)).values()]).toEqual(["current", "proposed", "future"]);
  });

  it("keeps recent and upcoming hosted types, deduplicated with signups", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));
    const db = database(
      ["recent", "upcoming", "old", "other"],
      [prickle("recent", "2026-09-01T00:00:00Z"), prickle("upcoming", "2026-11-01T00:00:00Z"), prickle("old", "2026-01-01T00:00:00Z"), prickle("other", "2026-11-01T00:00:00Z", OTHER)],
      [signup("upcoming", "2026-11-01")]
    );
    expect([...(await getHostVibeTypes(db, HOST)).values()]).toEqual(["recent", "upcoming"]);
  });

  it("is empty for a host with nothing", async () => {
    expect((await getHostVibeTypes(database([], [], []), HOST)).size).toBe(0);
  });
});
