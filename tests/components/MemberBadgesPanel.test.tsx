// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MemberBadgesPanel from "@/app/(admin)/admin/members/[id]/MemberBadgesPanel";
import type { EarnedBadge } from "@/lib/badges";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh }),
}));

const hostessBadge: EarnedBadge = {
  badgeType: {
    id: "bt-hostess",
    key: "hostess",
    name: "Hostess",
    description: "Hosted a prickle for a quarter.",
    icon: "🎙️",
    category: "community",
    has_levels: true,
    is_automatic: false,
  },
  levelName: "Hostess",
  level: 1,
  occurrences: 1,
  firstAwardedAt: "2025-01-01",
  lastAwardedAt: "2025-01-01",
  note: null,
};

const awardableBadgeTypes = [{ id: "bt-hostess", name: "Hostess", icon: "🎙️" }];

const awards = [
  {
    id: "mb-1",
    badgeTypeId: "bt-hostess",
    badgeTypeName: "Hostess",
    badgeTypeIcon: "🎙️",
    occurredAt: "2025-01-01",
    note: null,
  },
];

beforeEach(() => {
  refresh.mockReset();
  vi.restoreAllMocks();
});

describe("MemberBadgesPanel", () => {
  it("renders earned badges and award history", () => {
    render(
      <MemberBadgesPanel
        memberId="m1"
        earnedBadges={[hostessBadge]}
        awardableBadgeTypes={awardableBadgeTypes}
        awards={awards}
      />
    );
    expect(screen.getByText("Hostess")).toBeInTheDocument();
    expect(screen.getByText("Award history")).toBeInTheDocument();
  });

  it("shows a fallback message when no badges are earned yet", () => {
    render(
      <MemberBadgesPanel
        memberId="m1"
        earnedBadges={[]}
        awardableBadgeTypes={awardableBadgeTypes}
        awards={[]}
      />
    );
    expect(screen.getByText("No badges yet.")).toBeInTheDocument();
  });

  it("awards a badge and refreshes on submit", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ memberBadge: { id: "mb-2" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemberBadgesPanel
        memberId="m1"
        earnedBadges={[]}
        awardableBadgeTypes={awardableBadgeTypes}
        awards={[]}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "Award" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/member-badges/award",
      expect.objectContaining({ method: "POST" })
    ));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ memberId: "m1", badgeTypeId: "bt-hostess" });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("shows the error message when awarding fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "This badge is computed automatically and can't be manually awarded" }),
      })
    );

    render(
      <MemberBadgesPanel
        memberId="m1"
        earnedBadges={[]}
        awardableBadgeTypes={awardableBadgeTypes}
        awards={[]}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "Award" }));

    expect(
      await screen.findByText("This badge is computed automatically and can't be manually awarded")
    ).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("revokes an award and refreshes on click", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemberBadgesPanel
        memberId="m1"
        earnedBadges={[hostessBadge]}
        awardableBadgeTypes={awardableBadgeTypes}
        awards={awards}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "Revoke" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/member-badges/mb-1", { method: "DELETE" })
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});
