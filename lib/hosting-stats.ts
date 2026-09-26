/** >5-minute-late threshold for host punctuality -- single source of truth, shared by the admin
 * calendar's host_missing/host_late flags and the member Hosting page's own stats. */
export const HOST_LATE_THRESHOLD_MS = 5 * 60 * 1000;

export type HostPunctuality = "on_time" | "late" | "missing";

/** `earliestJoinTime` should be the host's earliest prickle_attendance.join_time for that
 * prickle (a host can leave/rejoin, per CLAUDE.md's attendance model) or null if they never
 * showed up. */
export function computeHostPunctuality(
  prickleStartTime: string,
  earliestJoinTime: string | null
): HostPunctuality {
  if (!earliestJoinTime) return "missing";
  const prickleStart = new Date(prickleStartTime).getTime();
  const hostJoin = new Date(earliestJoinTime).getTime();
  return hostJoin - prickleStart > HOST_LATE_THRESHOLD_MS ? "late" : "on_time";
}

// "YYYY-MM" for a timestamptz, in UTC -- matches quarterKey's UTC convention in lib/badges.ts.
function monthKey(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export interface HostedPrickleRecord {
  prickleId: string;
  typeName: string;
  startTime: string;
  /** Scheduled end. Host attendance only lands once Zoom reports the meeting ended (webhook on
   * meeting.ended, plus the nightly reconcile), so a still-running prickle with no host join yet
   * is "pending", not a no-show. Omit to treat the prickle as already over. */
  endTime?: string;
  /** Host's earliest join_time for this prickle, or null if they never attended it. */
  earliestJoinTime: string | null;
  /** Distinct members who attended this prickle (host included). Only populated when the
   * caller asked for attendee counts -- see fetchHostedPrickleRecords. */
  attendeeCount?: number;
}

export interface HostingTypeBreakdown {
  typeName: string;
  count: number;
}

export interface HostingStats {
  totalHosted: number;
  onTimeCount: number;
  lateCount: number;
  /** No-shows: hosted prickles that are over and have no host attendance record at all (joined
   * zero times). Excludes in-progress prickles the host hasn't been seen in yet. */
  missingCount: number;
  /** Share of hosted prickles the host showed up to at all, late or not:
   * (onTime + late) / (onTime + late + missing). Null if nothing can be judged yet. Nests with
   * onTimeRate -- show-up rate says whether they came, on-time rate says how promptly. */
  showUpRate: number | null;
  /** Punctuality rate among prickles the host actually showed up to (excludes no-shows); null
   * if they've never attended a prickle they hosted. */
  onTimeRate: number | null;
  mostRecentHostedAt: string | null;
  /** Count hosted per month, oldest to newest, for the trailing 12 calendar months (UTC,
   * including the current month). */
  monthlyTrend: number[];
  byType: HostingTypeBreakdown[];
}

const TREND_MONTHS = 12;

/** Pure aggregation over a member's hosting history -- feed it every prickle they've hosted
 * (paginated fetch is the caller's job, see getMyHostingStats). Prickles that haven't started
 * yet (startTime > now) are ignored entirely: a future occurrence is never "hosted" and never a
 * no-show. */
export function computeHostingStats(
  records: HostedPrickleRecord[],
  now: Date = new Date()
): HostingStats {
  let onTimeCount = 0;
  let lateCount = 0;
  let missingCount = 0;
  let mostRecentHostedAt: string | null = null;

  const countsByType = new Map<string, number>();
  const countsByMonth = new Map<string, number>();

  const nowMs = now.getTime();
  const pastRecords = records.filter((r) => new Date(r.startTime).getTime() <= nowMs);

  for (const r of pastRecords) {
    const punctuality = computeHostPunctuality(r.startTime, r.earliestJoinTime);
    if (punctuality === "on_time") onTimeCount++;
    else if (punctuality === "late") lateCount++;
    else if (!r.endTime || new Date(r.endTime).getTime() <= nowMs) missingCount++;
    // else: still in progress with no host join recorded yet -- neither shown up nor a no-show.

    if (!mostRecentHostedAt || r.startTime > mostRecentHostedAt) mostRecentHostedAt = r.startTime;

    countsByType.set(r.typeName, (countsByType.get(r.typeName) ?? 0) + 1);
    countsByMonth.set(monthKey(r.startTime), (countsByMonth.get(monthKey(r.startTime)) ?? 0) + 1);
  }

  const monthlyTrend: number[] = [];
  for (let i = TREND_MONTHS - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    monthlyTrend.push(countsByMonth.get(monthKey(d.toISOString())) ?? 0);
  }

  const attended = onTimeCount + lateCount;
  const judged = attended + missingCount;
  const byType = Array.from(countsByType.entries())
    .map(([typeName, count]) => ({ typeName, count }))
    .sort((a, b) => b.count - a.count);

  return {
    totalHosted: pastRecords.length,
    onTimeCount,
    lateCount,
    missingCount,
    showUpRate: judged > 0 ? attended / judged : null,
    onTimeRate: attended > 0 ? onTimeCount / attended : null,
    mostRecentHostedAt,
    monthlyTrend,
    byType,
  };
}

/** The subset of hosting history that's appropriate to show to *other* members on a public
 * profile. Deliberately excludes punctuality (on-time rate, late/no-show counts) -- those are
 * shown only to the host themselves on /my-prickles and to admins. */
export interface PublicHostingSummary {
  totalHosted: number;
  firstHostedAt: string | null;
  mostRecentHostedAt: string | null;
  /** Mean distinct attendees (host included, matching the "Typically ~N Hedgies" hint on All
   * Prickles) across hosted prickles that carry an attendeeCount; null if none do. */
  avgAttendance: number | null;
  /** Prickle types hosted, most-hosted first. */
  typeNames: string[];
}

export function computePublicHostingSummary(records: HostedPrickleRecord[]): PublicHostingSummary {
  let firstHostedAt: string | null = null;
  let mostRecentHostedAt: string | null = null;
  let attendeeTotal = 0;
  let countedPrickles = 0;
  const countsByType = new Map<string, number>();

  for (const r of records) {
    if (!firstHostedAt || r.startTime < firstHostedAt) firstHostedAt = r.startTime;
    if (!mostRecentHostedAt || r.startTime > mostRecentHostedAt) mostRecentHostedAt = r.startTime;
    if (r.attendeeCount !== undefined) {
      attendeeTotal += r.attendeeCount;
      countedPrickles++;
    }
    countsByType.set(r.typeName, (countsByType.get(r.typeName) ?? 0) + 1);
  }

  const typeNames = Array.from(countsByType.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([typeName]) => typeName);

  return {
    totalHosted: records.length,
    firstHostedAt,
    mostRecentHostedAt,
    avgAttendance: countedPrickles > 0 ? attendeeTotal / countedPrickles : null,
    typeNames,
  };
}
