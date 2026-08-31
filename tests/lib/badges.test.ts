import { describe, it, expect } from "vitest";
import {
  deriveLevel,
  isFoundingHedgie,
  computeEarnedBadges,
  type BadgeType,
  type BadgeLevel,
} from "@/lib/badges";

const levels: BadgeLevel[] = [
  { id: "l1", badge_type_id: "t1", level: 1, name: "Bronze", threshold: 1 },
  { id: "l2", badge_type_id: "t1", level: 2, name: "Silver", threshold: 10 },
  { id: "l3", badge_type_id: "t1", level: 3, name: "Gold", threshold: 100 },
];

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

  const levelsByBadgeType = new Map<string, BadgeLevel[]>([
    ["bt-milestones", milestoneLevels],
    ["bt-hostess", hostessLevels],
  ]);

  it("computes automatic prickle-milestone badges from attendance count, never reading member_badges", () => {
    const earned = computeEarnedBadges(
      [prickleMilestones],
      levelsByBadgeType,
      [{ badge_type_id: "bt-milestones", occurred_at: "2020-01-01", note: null }], // should be ignored
      12,
      null
    );
    expect(earned).toHaveLength(1);
    expect(earned[0].levelName).toBe("10 Prickles");
    expect(earned[0].occurrences).toBe(12);
  });

  it("omits the automatic milestone badge below the first threshold", () => {
    const earned = computeEarnedBadges([prickleMilestones], levelsByBadgeType, [], 0, null);
    expect(earned).toHaveLength(0);
  });

  it("computes the automatic Founding Hedgie badge from join date", () => {
    const earned = computeEarnedBadges([foundingHedgie], levelsByBadgeType, [], 0, "2021-05-01");
    expect(earned).toHaveLength(1);
    expect(earned[0].levelName).toBe("Founding Hedgie");
  });

  it("derives a manual leveled badge's level from the number of awarded occurrences", () => {
    const earned = computeEarnedBadges(
      [hostess],
      levelsByBadgeType,
      [
        { badge_type_id: "bt-hostess", occurred_at: "2025-01-01", note: "Q1" },
        { badge_type_id: "bt-hostess", occurred_at: "2025-04-01", note: "Q2" },
      ],
      0,
      null
    );
    expect(earned).toHaveLength(1);
    expect(earned[0].levelName).toBe("Hostess"); // 2 occurrences, below the 5x threshold
    expect(earned[0].occurrences).toBe(2);
    expect(earned[0].firstAwardedAt).toBe("2025-01-01");
    expect(earned[0].lastAwardedAt).toBe("2025-04-01");
  });

  it("shows a non-leveled manual badge once regardless of duplicate rows", () => {
    const earned = computeEarnedBadges(
      [retreat],
      levelsByBadgeType,
      [{ badge_type_id: "bt-retreat", occurred_at: "2025-10-01", note: null }],
      0,
      null
    );
    expect(earned).toHaveLength(1);
    expect(earned[0].levelName).toBe("Fall 2025 Virtual Retreat");
    expect(earned[0].level).toBeNull();
  });

  it("omits badge types with no awards and no automatic match", () => {
    const earned = computeEarnedBadges([hostess, retreat], levelsByBadgeType, [], 0, null);
    expect(earned).toHaveLength(0);
  });
});
