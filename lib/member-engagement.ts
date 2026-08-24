export interface EngagementAttendanceRow {
  member_id: string;
  prickle_id: string;
  join_time: string;
}

export interface MemberEngagementMetrics {
  lastAttendedAt: string | null;
  pricklesLast30Days: number;
  totalPrickles: number;
  engagementScore: number;
  riskLevel: "high" | "medium" | "low";
  engagementTier: "highly_engaged" | "active" | "at_risk";
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const FIFTEEN_DAYS_MS = 15 * 24 * 60 * 60 * 1000;

// Count DISTINCT prickle_id per member — a member can have multiple
// attendance rows per prickle (leave/rejoin), see CLAUDE.md.
export function computeMemberEngagementMetrics(
  attendance: EngagementAttendanceRow[],
  memberIds: string[],
  now: Date = new Date()
): Map<string, MemberEngagementMetrics> {
  const nowMs = now.getTime();
  const thirtyDaysAgoMs = nowMs - THIRTY_DAYS_MS;

  const lastAttendedMs = new Map<string, number>();
  const totalPrickleIds = new Map<string, Set<string>>();
  const last30PrickleIds = new Map<string, Set<string>>();

  for (const record of attendance) {
    const joinMs = new Date(record.join_time).getTime();

    const currentLast = lastAttendedMs.get(record.member_id);
    if (currentLast === undefined || joinMs > currentLast) {
      lastAttendedMs.set(record.member_id, joinMs);
    }

    if (!totalPrickleIds.has(record.member_id)) {
      totalPrickleIds.set(record.member_id, new Set());
    }
    totalPrickleIds.get(record.member_id)!.add(record.prickle_id);

    if (joinMs >= thirtyDaysAgoMs) {
      if (!last30PrickleIds.has(record.member_id)) {
        last30PrickleIds.set(record.member_id, new Set());
      }
      last30PrickleIds.get(record.member_id)!.add(record.prickle_id);
    }
  }

  const metrics = new Map<string, MemberEngagementMetrics>();

  for (const memberId of memberIds) {
    const lastMs = lastAttendedMs.get(memberId) ?? null;
    const pricklesLast30Days = last30PrickleIds.get(memberId)?.size ?? 0;
    const totalPrickles = totalPrickleIds.get(memberId)?.size ?? 0;
    const engagementScore = Math.min(100, pricklesLast30Days * 10);

    let riskLevel: MemberEngagementMetrics["riskLevel"];
    if (lastMs === null) {
      riskLevel = "high";
    } else {
      const msSinceLastAttended = nowMs - lastMs;
      if (msSinceLastAttended > THIRTY_DAYS_MS) riskLevel = "high";
      else if (msSinceLastAttended >= FIFTEEN_DAYS_MS) riskLevel = "medium";
      else riskLevel = "low";
    }

    const engagementTier: MemberEngagementMetrics["engagementTier"] =
      engagementScore >= 50 ? "highly_engaged" : engagementScore > 0 ? "active" : "at_risk";

    metrics.set(memberId, {
      lastAttendedAt: lastMs !== null ? new Date(lastMs).toISOString() : null,
      pricklesLast30Days,
      totalPrickles,
      engagementScore,
      riskLevel,
      engagementTier,
    });
  }

  return metrics;
}
