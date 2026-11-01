import { describe, it, expect, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

const { abandonCalendarSync, CLAIM_STALE_MS, claimCalendarSync, releaseCalendarSync, saveSyncedThrough } = await import("@/lib/google-calendar/sync-state");

const db = {} as never;
const NOW = new Date("2026-10-28T12:00:00Z");

describe("calendar sync state wrappers", () => {
  it("claim, release, watermark and abandon go through the repository", async () => {
    repos = createInMemoryRepos(new InMemoryDataset());

    expect(await claimCalendarSync(db, "cal", NOW)).toEqual({ claimed: true, syncedThrough: null });
    expect(await claimCalendarSync(db, "cal", NOW)).toEqual({ claimed: false });
    expect(await releaseCalendarSync(db, "cal", NOW)).toBe(false); // a rerun was requested
    expect(await releaseCalendarSync(db, "cal", NOW)).toBe(true);
    await saveSyncedThrough(db, "cal", NOW);
    expect(await claimCalendarSync(db, "cal", new Date(NOW.getTime() + CLAIM_STALE_MS))).toEqual({ claimed: true, syncedThrough: NOW });
    await abandonCalendarSync(db, "cal");
    expect(await claimCalendarSync(db, "cal", NOW)).toMatchObject({ claimed: true });
  });

  it("abandoning logs a failure instead of throwing, since the sync is already over", async () => {
    repos = createInMemoryRepos();
    vi.spyOn(repos.calendarSyncState, "abandon").mockRejectedValueOnce(new Error("database is down"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(abandonCalendarSync(db, "cal")).resolves.toBeUndefined();

    expect(log).toHaveBeenCalledWith("[calendar-sync] could not release the claim:", "database is down");
    log.mockRestore();
  });
});
