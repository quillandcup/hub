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
  /** Host's earliest join_time for this prickle, or null if they never attended it. */
  earliestJoinTime: string | null;
}

export interface HostingTypeBreakdown {
  typeName: string;
  count: number;
}

export interface HostingStats {
  totalHosted: number;
  onTimeCount: number;
  lateCount: number;
  missingCount: number;
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
 * (paginated fetch is the caller's job, see getMyHostingStats). */
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

  for (const r of records) {
    const punctuality = computeHostPunctuality(r.startTime, r.earliestJoinTime);
    if (punctuality === "on_time") onTimeCount++;
    else if (punctuality === "late") lateCount++;
    else missingCount++;

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
  const byType = Array.from(countsByType.entries())
    .map(([typeName, count]) => ({ typeName, count }))
    .sort((a, b) => b.count - a.count);

  return {
    totalHosted: records.length,
    onTimeCount,
    lateCount,
    missingCount,
    onTimeRate: attended > 0 ? onTimeCount / attended : null,
    mostRecentHostedAt,
    monthlyTrend,
    byType,
  };
}
