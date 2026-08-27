export interface EngagementAttendanceRow {
  member_id: string;
  prickle_id: string;
  join_time: string;
}

// Non-Prickle engagement signals from the `member_activities` table (Slack
// messages/reactions today; other activity types per docs/TODO.md "Activity
// Feed Expansion" later). `engagement_value` is pre-weighted per activity by
// whatever processed it into Silver (see calculateMessageValue in
// app/api/process/slack/route.ts).
export interface EngagementActivityRow {
  member_id: string;
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

// Count DISTINCT prickle_id per member — a member can have multiple
// attendance rows per prickle (leave/rejoin), see CLAUDE.md.
export function computeMemberEngagementMetrics(
  attendance: EngagementAttendanceRow[],
  memberIds: string[],
  now: Date = new Date(),
  activities: EngagementActivityRow[] = []
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

  // Slack (and future) activity points, last 30 days only — same window as
  // pricklesLast30Days so the two signals combine on equal footing.
  const activityPointsLast30 = new Map<string, number>();
  for (const record of activities) {
    const occurredMs = new Date(record.occurred_at).getTime();
    if (occurredMs >= thirtyDaysAgoMs) {
      activityPointsLast30.set(
        record.member_id,
        (activityPointsLast30.get(record.member_id) ?? 0) + record.engagement_value
      );
    }
  }

  const metrics = new Map<string, MemberEngagementMetrics>();

  for (const memberId of memberIds) {
    const lastMs = lastAttendedMs.get(memberId) ?? null;
    const pricklesLast30Days = last30PrickleIds.get(memberId)?.size ?? 0;
    const totalPrickles = totalPrickleIds.get(memberId)?.size ?? 0;
    const activityPointsLast30Days = activityPointsLast30.get(memberId) ?? 0;
    // Prickle attendance is weighted higher (10 pts/prickle) than Slack/other
    // activity (1-3 pts each, per calculateMessageValue) per docs/TODO.md
    // "CRM Features > Slack Integration > Phase 3: Combined Engagement Scoring".
    const engagementScore = Math.min(100, pricklesLast30Days * 10 + activityPointsLast30Days);

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
      totalPrickles,
      activityPointsLast30Days,
      engagementScore,
      riskLevel,
      engagementTier,
    });
  }

  return metrics;
}
