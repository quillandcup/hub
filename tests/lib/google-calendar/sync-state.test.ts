import { describe, it, expect, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

import { abandonCalendarSync, CLAIM_STALE_MS, claimCalendarSync, releaseCalendarSync, saveSyncedThrough } from "@/lib/google-calendar/sync-state";

const NOW = new Date("2026-10-28T12:00:00Z");

describe("calendar sync state wrappers", () => {
  it("claim, release, watermark and abandon go through the repository", async () => {
    const repos = createInMemoryRepos(new InMemoryDataset());

    expect(await claimCalendarSync(repos, "cal", NOW)).toEqual({ claimed: true, syncedThrough: null });
    expect(await claimCalendarSync(repos, "cal", NOW)).toEqual({ claimed: false });
    expect(await releaseCalendarSync(repos, "cal", NOW)).toBe(false); // a rerun was requested
    expect(await releaseCalendarSync(repos, "cal", NOW)).toBe(true);
    await saveSyncedThrough(repos, "cal", NOW);
    expect(await claimCalendarSync(repos, "cal", new Date(NOW.getTime() + CLAIM_STALE_MS))).toEqual({ claimed: true, syncedThrough: NOW });
    await abandonCalendarSync(repos, "cal");
    expect(await claimCalendarSync(repos, "cal", NOW)).toMatchObject({ claimed: true });
  });

  it("abandoning logs a failure instead of throwing, since the sync is already over", async () => {
    const repos = createInMemoryRepos();
    vi.spyOn(repos.calendarSyncState, "abandon").mockRejectedValueOnce(new Error("database is down"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(abandonCalendarSync(repos, "cal")).resolves.toBeUndefined();

    expect(log).toHaveBeenCalledWith("[calendar-sync] could not release the claim:", "database is down");
    log.mockRestore();
  });
});
