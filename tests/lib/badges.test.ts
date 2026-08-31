import { describe, it, expect } from "vitest";
import {
  deriveLevel,
  isFoundingHedgie,
  quarterKey,
  computeEarnedBadges,
  type BadgeType,
  type BadgeLevel,
  type AutomaticBadgeMetrics,
} from "@/lib/badges";

const levels: BadgeLevel[] = [
  { id: "l1", badge_type_id: "t1", level: 1, name: "Bronze", threshold: 1 },
  { id: "l2", badge_type_id: "t1", level: 2, name: "Silver", threshold: 10 },
  { id: "l3", badge_type_id: "t1", level: 3, name: "Gold", threshold: 100 },
];

const NO_METRICS: AutomaticBadgeMetrics = {
  totalPricklesAttended: 0,
  firstJoinedAt: null,
  hostedQuarterCount: 0,
  publishedBookCount: 0,
};

describe("deriveLevel", () => {
  it("returns null when no threshold is met", () => {
    expect(deriveLevel(levels, 0)).toBeNull();
  });

  it("returns the exact level when the count matches its threshold", () => {
    expect(deriveLevel(levels, 1)?.name).toBe("Bronze");
    expect(deriveLevel(levels, 10)?.name).toBe("Silver");
  });

  it("returns the highest level met, not the first", () => {
    expect(deriveLevel(levels, 50)?.name).toBe("Silver");
    expect(deriveLevel(levels, 1000)?.name).toBe("Gold");
  });

  it("treats a null threshold as always met", () => {
    const withUnconditional: BadgeLevel[] = [
      { id: "l1", badge_type_id: "t1", level: 1, name: "Only", threshold: null },
    ];
    expect(deriveLevel(withUnconditional, 0)?.name).toBe("Only");
  });
});

describe("isFoundingHedgie", () => {
  it("is true for 2021 joins", () => {
    expect(isFoundingHedgie("2021-06-15")).toBe(true);
  });

  it("is true for joins through March of 2022", () => {
    expect(isFoundingHedgie("2022-01-01")).toBe(true);
    expect(isFoundingHedgie("2022-03-31")).toBe(true);
  });

  it("is false starting April 2022", () => {
    expect(isFoundingHedgie("2022-04-01")).toBe(false);
  });

  it("is false for null (never had a real subscription)", () => {
    expect(isFoundingHedgie(null)).toBe(false);
  });
});

describe("quarterKey", () => {
  it("buckets a timestamp into its UTC calendar quarter", () => {
    expect(quarterKey("2025-01-15T12:00:00Z")).toBe("2025-Q1");
    expect(quarterKey("2025-04-01T00:00:00Z")).toBe("2025-Q2");
    expect(quarterKey("2025-09-30T23:59:59Z")).toBe("2025-Q3");
    expect(quarterKey("2025-12-31T23:59:59Z")).toBe("2025-Q4");
  });
});

describe("computeEarnedBadges", () => {
  const prickleMilestones: BadgeType = {
    id: "bt-milestones",
    key: "prickle_milestones",
    name: "Prickle Milestones",
    description: null,
    icon: "🌵",
    category: "milestone",
    has_levels: true,
    is_automatic: true,
  };
  const foundingHedgie: BadgeType = {
    id: "bt-founding",
    key: "founding_hedgie",
    name: "Founding Hedgie",
    description: null,
    icon: "🦔",
    category: "special",
    has_levels: false,
    is_automatic: true,
  };
  const hostess: BadgeType = {
    id: "bt-hostess",
    key: "hostess",
    name: "Hostess",
    description: null,
    icon: "🎙️",
    category: "community",
    has_levels: true,
    is_automatic: true,
  };
  const publishedAuthor: BadgeType = {
    id: "bt-author",
    key: "published_author",
    name: "Published Author",
    description: null,
    icon: "📚",
    category: "community",
    has_levels: true,
    is_automatic: true,
  };
  const hedgieMentor: BadgeType = {
    id: "bt-mentor",
    key: "hedgie_mentor",
    name: "Hedgie Mentor",
    description: null,
    icon: "🧭",
    category: "community",
    has_levels: true,
    is_automatic: false,
  };
  const retreat: BadgeType = {
    id: "bt-retreat",
    key: "fall_2025_virtual_retreat",
    name: "Fall 2025 Virtual Retreat",
    description: null,
    icon: "🏕️",
    category: "retreat",
    has_levels: false,
    is_automatic: false,
  };

  const milestoneLevels: BadgeLevel[] = [
    { id: "m1", badge_type_id: "bt-milestones", level: 1, name: "First Prickle", threshold: 1 },
    { id: "m2", badge_type_id: "bt-milestones", level: 2, name: "10 Prickles", threshold: 10 },
  ];
  const hostessLevels: BadgeLevel[] = [
    { id: "h1", badge_type_id: "bt-hostess", level: 1, name: "Hostess", threshold: 1 },
    { id: "h2", badge_type_id: "bt-hostess", level: 2, name: "5x Hostess", threshold: 5 },
  ];
  const authorLevels: BadgeLevel[] = [
    { id: "a1", badge_type_id: "bt-author", level: 1, name: "Published Author", threshold: 1 },
    { id: "a2", badge_type_id: "bt-author", level: 2, name: "3x Published Author", threshold: 3 },
  ];
  const mentorLevels: BadgeLevel[] = [
    { id: "me1", badge_type_id: "bt-mentor", level: 1, name: "Hedgie Mentor", threshold: 1 },
    { id: "me2", badge_type_id: "bt-mentor", level: 2, name: "2x Hedgie Mentor", threshold: 2 },
  ];

  const levelsByBadgeType = new Map<string, BadgeLevel[]>([
    ["bt-milestones", milestoneLevels],
    ["bt-hostess", hostessLevels],
    ["bt-author", authorLevels],
    ["bt-mentor", mentorLevels],
  ]);

  it("computes automatic prickle-milestone badges from attendance count, never reading member_badges", () => {
    const earned = computeEarnedBadges(
      [prickleMilestones],
      levelsByBadgeType,
      [{ badge_type_id: "bt-milestones", occurred_at: "2020-01-01", note: null }], // should be ignored
      { ...NO_METRICS, totalPricklesAttended: 12 }
    );
    expect(earned).toHaveLength(1);
    expect(earned[0].levelName).toBe("10 Prickles");
    expect(earned[0].occurrences).toBe(12);
  });

  it("omits the automatic milestone badge below the first threshold", () => {
    const earned = computeEarnedBadges([prickleMilestones], levelsByBadgeType, [], NO_METRICS);
    expect(earned).toHaveLength(0);
  });

  it("computes the automatic Founding Hedgie badge from join date", () => {
    const earned = computeEarnedBadges([foundingHedgie], levelsByBadgeType, [], {
      ...NO_METRICS,
      firstJoinedAt: "2021-05-01",
    });
    expect(earned).toHaveLength(1);
    expect(earned[0].levelName).toBe("Founding Hedgie");
  });

  it("computes the automatic Hostess badge from hosted-quarter count, never reading member_badges", () => {
    const earned = computeEarnedBadges(
      [hostess],
      levelsByBadgeType,
      [{ badge_type_id: "bt-hostess", occurred_at: "2020-01-01", note: "stale manual row" }],
      { ...NO_METRICS, hostedQuarterCount: 5 }
    );
    expect(earned).toHaveLength(1);
    expect(earned[0].levelName).toBe("5x Hostess");
    expect(earned[0].occurrences).toBe(5);
  });

  it("omits the automatic Hostess badge when the member has never hosted", () => {
    const earned = computeEarnedBadges([hostess], levelsByBadgeType, [], NO_METRICS);
    expect(earned).toHaveLength(0);
  });

  it("computes the automatic Published Author badge from the member's book count", () => {
    const earned = computeEarnedBadges([publishedAuthor], levelsByBadgeType, [], {
      ...NO_METRICS,
      publishedBookCount: 3,
    });
    expect(earned).toHaveLength(1);
    expect(earned[0].levelName).toBe("3x Published Author");
    expect(earned[0].occurrences).toBe(3);
  });

  it("omits the automatic Published Author badge with zero books", () => {
    const earned = computeEarnedBadges([publishedAuthor], levelsByBadgeType, [], NO_METRICS);
    expect(earned).toHaveLength(0);
  });

  it("derives a manual leveled badge's level from the number of awarded occurrences", () => {
    const earned = computeEarnedBadges(
      [hedgieMentor],
      levelsByBadgeType,
      [
        { badge_type_id: "bt-mentor", occurred_at: "2025-01-01", note: "Person A" },
        { badge_type_id: "bt-mentor", occurred_at: "2025-04-01", note: "Person B" },
      ],
      NO_METRICS
    );
    expect(earned).toHaveLength(1);
    expect(earned[0].levelName).toBe("2x Hedgie Mentor");
    expect(earned[0].occurrences).toBe(2);
    expect(earned[0].firstAwardedAt).toBe("2025-01-01");
    expect(earned[0].lastAwardedAt).toBe("2025-04-01");
  });

  it("shows a non-leveled manual badge once regardless of duplicate rows", () => {
    const earned = computeEarnedBadges(
      [retreat],
      levelsByBadgeType,
      [{ badge_type_id: "bt-retreat", occurred_at: "2025-10-01", note: null }],
      NO_METRICS
    );
    expect(earned).toHaveLength(1);
    expect(earned[0].levelName).toBe("Fall 2025 Virtual Retreat");
    expect(earned[0].level).toBeNull();
  });

  it("omits badge types with no awards and no automatic match", () => {
    const earned = computeEarnedBadges([hedgieMentor, retreat], levelsByBadgeType, [], NO_METRICS);
    expect(earned).toHaveLength(0);
  });
});
