import { describe, expect, it } from "vitest";
import {
  computeBadgeRecipients,
  computeEarnedBadges,
  type AutomaticBadgeMetrics,
  type BadgeLevel,
  type BadgeType,
  type BulkAutomaticMetrics,
} from "@/lib/badges";

const bigSister: BadgeType = {
  id: "bt-mentor",
  key: "hedgie_mentor",
  name: "Big Sister",
  description: null,
  icon: "🧭",
  category: "community",
  has_levels: true,
  is_automatic: true,
  program_id: null,
};

const levels: BadgeLevel[] = [
  { id: "l1", badge_type_id: "bt-mentor", level: 1, name: "Big Sister", threshold: 1 },
  { id: "l2", badge_type_id: "bt-mentor", level: 2, name: "2x Big Sister", threshold: 2 },
  { id: "l3", badge_type_id: "bt-mentor", level: 3, name: "5x Big Sister", threshold: 5 },
];
const levelsByType = new Map([["bt-mentor", levels]]);

const NO_METRICS: AutomaticBadgeMetrics = {
  totalPricklesAttended: 0,
  firstJoinedAt: null,
  hostedQuarterCount: 0,
  publishedBookCount: 0,
  programCompletions: new Map(),
};

describe("Big Sister badge (computed from mentorships)", () => {
  it("earns tiers from the number of matches", () => {
    const earned = computeEarnedBadges([bigSister], levelsByType, [], {
      ...NO_METRICS,
      mentorship: { count: 5, firstStartedOn: "2025-01-01", lastStartedOn: "2026-03-01" },
    });
    expect(earned).toHaveLength(1);
    expect(earned[0]).toMatchObject({
      levelName: "5x Big Sister",
      level: 3,
      occurrences: 5,
      firstAwardedAt: "2025-01-01",
      lastAwardedAt: "2026-03-01",
    });
  });

  it("is not earned with no matches", () => {
    expect(computeEarnedBadges([bigSister], levelsByType, [], NO_METRICS)).toEqual([]);
  });

  it("keeps hand-awarded badges from before tracking: the larger count wins, never the sum", () => {
    const awards = [
      { badge_type_id: "bt-mentor", occurred_at: "2024-05-01", note: null },
      { badge_type_id: "bt-mentor", occurred_at: "2024-08-01", note: "legacy" },
    ];
    const withTracked = computeEarnedBadges([bigSister], levelsByType, awards, {
      ...NO_METRICS,
      mentorship: { count: 1, firstStartedOn: "2026-01-01", lastStartedOn: "2026-01-01" },
    });
    expect(withTracked[0]).toMatchObject({ occurrences: 2, levelName: "2x Big Sister", note: "legacy" });

    const handOnly = computeEarnedBadges([bigSister], levelsByType, awards, NO_METRICS);
    expect(handOnly[0].occurrences).toBe(2);
  });

  it("lists recipients across members from the bulk counts", () => {
    const members = [
      { id: "a", name: "Alice", email: "a@example.com", firstJoinedAt: null },
      { id: "b", name: "Bea", email: "b@example.com", firstJoinedAt: null },
      { id: "c", name: "Cleo", email: "c@example.com", firstJoinedAt: null },
    ];
    const metrics: BulkAutomaticMetrics = {
      attendedPrickleCountsByMember: new Map(),
      hostedQuarterCountsByMember: new Map(),
      publishedBookCountsByMember: new Map(),
      programCompletionsByProgramId: new Map(),
      mentorshipByMember: new Map([
        ["a", { count: 2, firstStartedOn: "2025-01-01", lastStartedOn: "2025-06-01" }],
        ["b", { count: 1, firstStartedOn: "2026-01-01", lastStartedOn: "2026-01-01" }],
      ]),
    };
    const recipients = computeBadgeRecipients(
      bigSister,
      levels,
      members,
      [{ member_id: "c", occurred_at: "2024-01-01", note: null }],
      metrics
    );
    expect(recipients.map((r) => [r.memberName, r.levelName])).toEqual([
      ["Alice", "2x Big Sister"],
      ["Bea", "Big Sister"],
      ["Cleo", "Big Sister"],
    ]);
  });
});
