// Every input now comes from member_activities — prickle attendance is
// mirrored in there (see reprocess_prickle_attendance_atomic) atomically
// alongside prickle_attendance itself, so it can't drift out of sync.
// Previously this combined two independently-fetched sources (a direct
// prickle_attendance query plus member_activities) with a hand-written
// `pricklesLast30Days * 10` term; that risked double-counting if a mirror
// row were ever given a nonzero engagement_value. One source, one sum.
export interface EngagementActivityRow {
  member_id: string;
  activity_type: string;
  engagement_value: number;
  occurred_at: string;
}

export interface MemberEngagementMetrics {
  lastAttendedAt: string | null;
  pricklesLast30Days: number;
  totalPrickles: number;
  activityPointsLast30Days: number;
  engagementScore: number;
  riskLevel: "high" | "medium" | "low";
  engagementTier: "highly_engaged" | "active" | "at_risk";
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const FIFTEEN_DAYS_MS = 15 * 24 * 60 * 60 * 1000;
const PRICKLE_ACTIVITY_TYPE = "prickle_attended";

// `allPrickleAttended` is unbounded (all-time) — needed for totalPrickles and
// lastAttendedAt, which can be older than the 30-day scoring window.
// `recentActivities` is scoped by the caller's query to the last 30 days,
// across all activity types (including prickle_attended, for the score sum).
export function computeMemberEngagementMetrics(
  allPrickleAttended: Pick<EngagementActivityRow, "member_id" | "occurred_at">[],
  memberIds: string[],
  now: Date = new Date(),
  recentActivities: EngagementActivityRow[] = []
): Map<string, MemberEngagementMetrics> {
  const nowMs = now.getTime();
  const thirtyDaysAgoMs = nowMs - THIRTY_DAYS_MS;

  const lastAttendedMs = new Map<string, number>();
  const totalPrickles = new Map<string, number>();

  // Each row here is already one-per-(member_id, prickle_id), aggregated by
  // the mirror in reprocess_prickle_attendance_atomic, so a plain count is
  // correct — no need to dedupe by prickle_id again here.
  for (const record of allPrickleAttended) {
    const occurredMs = new Date(record.occurred_at).getTime();
    const currentLast = lastAttendedMs.get(record.member_id);
    if (currentLast === undefined || occurredMs > currentLast) {
      lastAttendedMs.set(record.member_id, occurredMs);
    }
    totalPrickles.set(record.member_id, (totalPrickles.get(record.member_id) ?? 0) + 1);
  }

  const pricklesLast30 = new Map<string, number>();
  const activityPointsLast30 = new Map<string, number>();
  for (const record of recentActivities) {
    // Callers scope this query to the last 30 days already, but filter here
    // too — defense in depth against a caller that doesn't.
    const occurredMs = new Date(record.occurred_at).getTime();
    if (occurredMs < thirtyDaysAgoMs) continue;

    if (record.activity_type === PRICKLE_ACTIVITY_TYPE) {
      pricklesLast30.set(record.member_id, (pricklesLast30.get(record.member_id) ?? 0) + 1);
    }
    activityPointsLast30.set(
      record.member_id,
      (activityPointsLast30.get(record.member_id) ?? 0) + record.engagement_value
    );
  }

  const metrics = new Map<string, MemberEngagementMetrics>();

  for (const memberId of memberIds) {
    const lastMs = lastAttendedMs.get(memberId) ?? null;
    const pricklesLast30Days = pricklesLast30.get(memberId) ?? 0;
    const totalPricklesCount = totalPrickles.get(memberId) ?? 0;
    const activityPointsLast30Days = activityPointsLast30.get(memberId) ?? 0;
    // Prickle attendance is weighted at 10 pts/prickle (engagement_value on
    // the prickle_attended mirror row) vs. 1-3 pts for Slack/other activity
    // (calculateMessageValue in app/api/process/slack/route.ts) — both are
    // already summed into activityPointsLast30Days.
    const engagementScore = Math.min(100, activityPointsLast30Days);

    let riskLevel: MemberEngagementMetrics["riskLevel"];
    if (lastMs === null) {
      riskLevel = "high";
    } else {
      const msSinceLastAttended = nowMs - lastMs;
      if (msSinceLastAttended > THIRTY_DAYS_MS) riskLevel = "high";
      else if (msSinceLastAttended >= FIFTEEN_DAYS_MS) riskLevel = "medium";
      else riskLevel = "low";
    }

    // A single light-touch Slack ping (1-3 pts) shouldn't alone be enough to
    // pull someone out of at_risk — require roughly a Prickle's worth of
    // signal (10 pts) before crediting "active".
    const engagementTier: MemberEngagementMetrics["engagementTier"] =
      engagementScore >= 50 ? "highly_engaged" : engagementScore >= 10 ? "active" : "at_risk";

    metrics.set(memberId, {
      lastAttendedAt: lastMs !== null ? new Date(lastMs).toISOString() : null,
      pricklesLast30Days,
      totalPrickles: totalPricklesCount,
      activityPointsLast30Days,
      engagementScore,
      riskLevel,
      engagementTier,
    });
  }

  return metrics;
}
