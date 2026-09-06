// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import MemberTimelinePanel from "@/app/(admin)/admin/members/[id]/MemberTimelinePanel";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-06T00:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("MemberTimelinePanel", () => {
  it("shows 'upcoming' instead of a negative duration for a segment queued behind a future-dated hiatus return", () => {
    render(
      <MemberTimelinePanel
        memberId="m1"
        hiatusHistory={[
          { id: "h1", start_date: "2026-07-20", end_date: "2026-10-18", reason: "travel", notes: null },
        ]}
        membershipHistory={[{ created_at_kajabi: "2024-01-01T00:00:00Z", derived_end_at: null, status: "active" }]}
      />
    );

    expect(screen.getByText("upcoming")).toBeInTheDocument();
    expect(screen.queryByText(/^-\d+ days?/)).not.toBeInTheDocument();
  });

  it("renders a muted gap row for a stretch with no membership, hiatus, or program coverage", () => {
    render(
      <MemberTimelinePanel
        memberId="m1"
        hiatusHistory={[]}
        membershipHistory={[
          { created_at_kajabi: "2022-09-29T00:00:00Z", derived_end_at: "2023-01-29T00:00:00Z", status: "cancelled" },
          { created_at_kajabi: "2023-06-15T00:00:00Z", derived_end_at: "2024-01-17T00:00:00Z", status: "cancelled" },
        ]}
      />
    );

    expect(screen.getByText(/not a member/)).toBeInTheDocument();
    expect(screen.getAllByText("Membership")).toHaveLength(2);
  });

  it("shows the program name alongside Membership when a program enrollment overlaps a real subscription", () => {
    render(
      <MemberTimelinePanel
        memberId="m1"
        hiatusHistory={[]}
        membershipHistory={[{ created_at_kajabi: "2023-05-06T00:00:00Z", derived_end_at: null, status: "active" }]}
        programOverrides={[{ id: "p1", starts_at: "2026-01-01", expires_at: "2026-07-01", reason: "180 Program" }]}
      />
    );

    expect(screen.getByText(/Membership \+ 180 Program/)).toBeInTheDocument();
    // Three segments (before/during/after the program) — all still "active",
    // since the membership must never look like it ended just because a
    // concurrent program did.
    expect(screen.getAllByText("active")).toHaveLength(3);
  });
});
