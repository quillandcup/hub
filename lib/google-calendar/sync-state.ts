import type { Repos } from "@/lib/data/repos";
import { CLAIM_STALE_MS } from "@/lib/data/calendar-sync-state";

export { CLAIM_STALE_MS };

type SyncStateRepos = Pick<Repos, "calendarSyncState">;

/**
 * Take the right to sync this calendar. Returns `{ claimed: true, syncedThrough }` when no other
 * sync holds it; otherwise leaves a note ("run once more") for the one that does and returns
 * `{ claimed: false }`, so a burst of notifications becomes one running sync plus one rerun.
 * Each step is a single conditional UPDATE, so two callers can't both win.
 */
export async function claimCalendarSync(
  repos: SyncStateRepos,
  calendarId: string,
  now: Date
): Promise<{ claimed: true; syncedThrough: Date | null } | { claimed: false }> {
  return repos.calendarSyncState.claim(calendarId, now);
}

/**
 * Let go of the claim, unless a notification asked for another run meanwhile. Returns true when
 * released, false when a rerun was requested (the claim is kept and the request cleared: run again).
 */
export async function releaseCalendarSync(repos: SyncStateRepos, calendarId: string, now: Date): Promise<boolean> {
  return repos.calendarSyncState.release(calendarId, now);
}

/** Let go after a failure, whatever was requested: the next notification starts from the old watermark. */
export async function abandonCalendarSync(repos: SyncStateRepos, calendarId: string): Promise<void> {
  try {
    await repos.calendarSyncState.abandon(calendarId);
  } catch (error) {
    console.error("[calendar-sync] could not release the claim:", error instanceof Error ? error.message : error);
  }
}

/** Record that everything the calendar changed before `startedAt` is in Bronze. */
export async function saveSyncedThrough(repos: SyncStateRepos, calendarId: string, startedAt: Date): Promise<void> {
  await repos.calendarSyncState.saveSyncedThrough(calendarId, startedAt);
}
