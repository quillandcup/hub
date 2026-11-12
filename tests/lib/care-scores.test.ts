import { describe, expect, it } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryActivityRepository } from "@/lib/data/activities";
import { CARE_SCORE_TIER_LABELS, loadCareScores } from "@/lib/care-scores";
import { computeMemberEngagementMetrics, engagementScoreAt } from "@/lib/member-engagement";

const ADA = "mbr_AAAAAAAAAAA1";
const BO = "mbr_AAAAAAAAAAA2";
const NOW = new Date("2026-03-20T15:00:00.000Z");
const OPENED = "2026-03-05T15:00:00.000Z";

function activityRepo(rows: { member: string; type?: string; at: string; points: number }[]) {
  const data = new InMemoryDataset();
  const repo = new InMemoryActivityRepository(data);
  return { data, repo, ready: repo.recordMany(rows.map((r, i) => ({ memberId: r.member, type: r.type ?? "slack_message", category: "communication", title: `row ${i}`, occurredAt: r.at, source: "slack", relatedId: `r${i}`, engagementValue: r.points }))) };
}

describe("engagementScoreAt", () => {
  const rows = (...specs: [string, number][]) => specs.map(([at, points]) => ({ member_id: ADA, activity_type: "slack_message", engagement_value: points, occurred_at: at }));

  it("gives the same answer as the member page's score when the instant is now", () => {
    const activity = rows(["2026-03-01T10:00:00.000Z", 10], ["2026-03-10T10:00:00.000Z", 30], ["2026-03-19T10:00:00.000Z", 12]);
    const page = computeMemberEngagementMetrics([], [ADA], NOW, activity).get(ADA)!;
    expect(engagementScoreAt(ADA, activity, NOW)).toEqual({ engagementScore: page.engagementScore, engagementTier: page.engagementTier });
    expect(engagementScoreAt(ADA, activity, NOW)).toEqual({ engagementScore: 52, engagementTier: "highly_engaged" });
  });

  it("ignores what came after the instant, and what is older than the 30 days before it", () => {
    const activity = rows(["2026-02-03T14:59:59.000Z", 40], ["2026-02-03T15:00:00.000Z", 5], ["2026-03-05T15:00:00.000Z", 6], ["2026-03-05T15:00:01.000Z", 99]);
    // The 30 days up to 2026-03-05T15:00Z start at 2026-02-03T15:00Z: the first row is just outside, the last is after.
    expect(engagementScoreAt(ADA, activity, new Date(OPENED))).toEqual({ engagementScore: 11, engagementTier: "active" });
  });

  it("caps at 100, puts under 10 at risk, and counts nobody else's rows", () => {
    expect(engagementScoreAt(ADA, rows(["2026-03-19T10:00:00.000Z", 70], ["2026-03-19T11:00:00.000Z", 70]), NOW)).toEqual({ engagementScore: 100, engagementTier: "highly_engaged" });
    expect(engagementScoreAt(ADA, rows(["2026-03-19T10:00:00.000Z", 9]), NOW)).toEqual({ engagementScore: 9, engagementTier: "at_risk" });
    expect(engagementScoreAt(BO, rows(["2026-03-19T10:00:00.000Z", 50]), NOW)).toEqual({ engagementScore: 0, engagementTier: "at_risk" });
  });
});

describe("loadCareScores", () => {
  it("works out the score when each care period started and now, from one batched read", async () => {
    const { repo, ready } = activityRepo([
      { member: ADA, at: "2026-02-20T10:00:00.000Z", points: 4 }, // before it opened: counts then, and now (within 30 days of now? no: 28 days) 
      { member: ADA, at: "2026-03-10T10:00:00.000Z", points: 30 }, // during: counts now only
      { member: ADA, at: "2026-03-18T10:00:00.000Z", points: 30 },
      { member: BO, at: "2026-03-19T10:00:00.000Z", points: 12 },
    ]);
    await ready;
    let reads = 0;
    const counting = { engagementRowsForWindows: (...args: Parameters<typeof repo.engagementRowsForWindows>) => (reads++, repo.engagementRowsForWindows(...args)) };

    const scores = await loadCareScores(
      counting,
      [
        { id: "care_AAAAAAAAAAA1", member_id: ADA, opened_at: OPENED },
        { id: "care_AAAAAAAAAAA2", member_id: BO, opened_at: "2026-03-18T15:00:00.000Z" },
      ],
      NOW
    );

    expect(reads).toBe(1);
    expect(scores.get("care_AAAAAAAAAAA1")).toEqual({ then: { score: 4, tier: "at_risk" }, now: { score: 64, tier: "highly_engaged" } });
    expect(scores.get("care_AAAAAAAAAAA2")).toEqual({ then: { score: 0, tier: "at_risk" }, now: { score: 12, tier: "active" } });
  });

  it("answers for nothing, and for a care period that opened at this very moment (then is now)", async () => {
    const { repo, ready } = activityRepo([{ member: ADA, at: "2026-03-20T14:00:00.000Z", points: 20 }]);
    await ready;
    expect((await loadCareScores(repo, [], NOW)).size).toBe(0);
    const scores = await loadCareScores(repo, [{ id: "care_AAAAAAAAAAA1", member_id: ADA, opened_at: NOW.toISOString() }], NOW);
    expect(scores.get("care_AAAAAAAAAAA1")).toEqual({ then: { score: 20, tier: "active" }, now: { score: 20, tier: "active" } });
  });

  it("names the three tiers", () => {
    expect(CARE_SCORE_TIER_LABELS).toEqual({ highly_engaged: "Highly engaged", active: "Active", at_risk: "At risk" });
  });
});
