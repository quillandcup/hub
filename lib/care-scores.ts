/**
 * The engagement score on a Hedgie Care row: where the member stood when the care period started and where they stand now,
 * both from the same rules as the member's own page (`lib/member-engagement.ts`: points of the last 30 days, capped at 100,
 * and the tier that follows). Nothing is stored: it is worked out when the page opens, for every row in one batched read.
 */
import type { ActivityRepository } from "@/lib/data/activities";
import { engagementWindowKey } from "@/lib/data/activities";
import { engagementScoreAt, type MemberEngagementMetrics } from "@/lib/member-engagement";

export type CareScoreTier = MemberEngagementMetrics["engagementTier"];

export const CARE_SCORE_TIER_LABELS: Record<CareScoreTier, string> = {
  highly_engaged: "Highly engaged",
  active: "Active",
  at_risk: "At risk",
};

export type CareScore = { score: number; tier: CareScoreTier };

/** The score when the care period started and the score now. */
export type CareScores = { then: CareScore; now: CareScore };

/**
 * The scores for these engagements, by engagement id: "then" is the 30 days up to when it opened, "now" the 30 days up to
 * `now`. One batched read for all of them (`engagementRowsForWindows`), then arithmetic in memory.
 */
export async function loadCareScores(
  activities: Pick<ActivityRepository, "engagementRowsForWindows">,
  engagements: readonly { id: string; member_id: string; opened_at: string }[],
  now: Date
): Promise<Map<string, CareScores>> {
  const nowIso = now.toISOString();
  const requests = engagements.flatMap((e) => [
    { memberId: e.member_id, endIso: new Date(e.opened_at).toISOString() },
    { memberId: e.member_id, endIso: nowIso },
  ]);
  const rows = await activities.engagementRowsForWindows(requests);
  const scoreAt = (memberId: string, at: Date): CareScore => {
    const { engagementScore, engagementTier } = engagementScoreAt(memberId, rows.get(engagementWindowKey({ memberId, endIso: at.toISOString() })) ?? [], at);
    return { score: engagementScore, tier: engagementTier };
  };
  return new Map(engagements.map((e) => [e.id, { then: scoreAt(e.member_id, new Date(e.opened_at)), now: scoreAt(e.member_id, now) }]));
}
