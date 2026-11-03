import { LIVE_WINDOW_MS } from "@/lib/live-room";
import { loadPresenceByMember, staysOf, toWindow, type PresenceRepos } from "@/lib/zoom-presence";

/** A member seen in a prickle's room by the live participant events, before the attendance import has it. */
export interface LiveAttendee {
  memberId: string;
  joinTime: string;
  /** When they left, or null while they are still in the room. */
  leaveTime: string | null;
}

/**
 * Who has been in the room of each prickle that is running or ended recently, from the Zoom participant
 * joined/left webhooks (lib/zoom-presence.ts). The attendance import only covers ended meetings and runs
 * after the fact, so this fills the gap: the admin calendar adds these to the imported attendance, and the
 * import stays the source of truth (a member in both is counted once). A stay counts by the same rule as
 * the import (`staysOf`), and a stay that began before the prickle is dated from its start.
 *
 * Reads participant events, so it needs service role repositories (the table is service role only).
 */
export async function loadLiveAttendance(
  repos: PresenceRepos,
  prickles: { id: string; startTime: string; endTime: string }[],
  now: Date = new Date()
): Promise<Map<string, LiveAttendee[]>> {
  const result = new Map<string, LiveAttendee[]>();
  const nowMs = now.getTime();
  const windows = prickles.map(toWindow);
  const recent = windows.filter((w) => w.start <= nowMs && w.end > nowMs - LIVE_WINDOW_MS);
  if (recent.length === 0) return result;

  const byMember = await loadPresenceByMember(repos, new Date(nowMs - LIVE_WINDOW_MS), now);
  for (const [memberId, intervals] of byMember) {
    for (const interval of intervals) {
      for (const stay of staysOf(interval, windows, nowMs)) {
        const window = recent.find((w) => w.id === stay.prickleId);
        if (!window || !stay.counts) continue;
        const joinedAt = Math.max(interval.join, window.start);
        result.set(stay.prickleId, [...(result.get(stay.prickleId) ?? []), { memberId, joinTime: new Date(joinedAt).toISOString(), leaveTime: interval.leave === null ? null : new Date(interval.leave).toISOString() }]);
      }
    }
  }
  return result;
}
