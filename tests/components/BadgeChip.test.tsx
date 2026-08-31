// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import BadgeChip from "@/components/BadgeChip";
import type { EarnedBadge } from "@/lib/badges";

function makeBadge(overrides: Partial<EarnedBadge> = {}): EarnedBadge {
  return {
    badgeType: {
      id: "bt-1",
      key: "founding_hedgie",
      name: "Founding Hedgie",
      description: "Joined during our founding era.",
      icon: "🦔",
      category: "special",
      has_levels: false,
      is_automatic: true,
    },
    levelName: "Founding Hedgie",
    level: null,
    occurrences: 1,
    firstAwardedAt: "2021-05-01",
    lastAwardedAt: "2021-05-01",
    note: null,
    ...overrides,
  };
}

describe("BadgeChip", () => {
  it("renders the icon and level name", () => {
    render(<BadgeChip badge={makeBadge()} />);
    expect(screen.getByText("🦔")).toBeInTheDocument();
    expect(screen.getByText("Founding Hedgie")).toBeInTheDocument();
  });

  it("renders the derived level name for a leveled badge, not the base badge name", () => {
    const badge = makeBadge({
      badgeType: {
        id: "bt-2",
        key: "hostess",
        name: "Hostess",
        description: null,
        icon: "🎙️",
        category: "community",
        has_levels: true,
        is_automatic: false,
      },
      levelName: "5x Hostess",
      level: 2,
      occurrences: 5,
    });
    render(<BadgeChip badge={badge} />);
    expect(screen.getByText("5x Hostess")).toBeInTheDocument();
    expect(screen.queryByText("Hostess")).not.toBeInTheDocument();
  });

  it("includes the occurrence count in the tooltip when awarded more than once", () => {
    const badge = makeBadge({ occurrences: 3 });
    render(<BadgeChip badge={badge} />);
    expect(screen.getByTitle(/Awarded 3 times/)).toBeInTheDocument();
  });
});
