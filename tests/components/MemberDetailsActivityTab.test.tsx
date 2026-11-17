// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { COMMUNITY_MANAGER_FEATURES, STAFF_FEATURES, type StaffFeature } from "@/lib/staff-access";
import MemberDetails from "@/app/(admin)/admin/members/[id]/MemberDetails";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("@/components/MemberAttendanceView", () => ({ default: () => null }));
vi.mock("@/app/(admin)/admin/members/[id]/MemberTimelinePanel", () => ({ default: () => null }));
vi.mock("@/app/(admin)/admin/members/[id]/MemberSlackActivityPanel", () => ({ default: () => null }));
vi.mock("@/app/(admin)/admin/members/[id]/MemberBadgesPanel", () => ({ default: () => null }));
vi.mock("@/app/(admin)/admin/members/[id]/MemberIdentityPanel", () => ({ default: () => null }));
vi.mock("@/app/(admin)/admin/members/[id]/MemberNoteForm", () => ({ default: () => <p>note form</p> }));
vi.mock("@/app/(admin)/admin/activity/ActivityFilters", () => ({
  default: ({ limited }: { limited?: boolean }) => <p>{limited ? "limited filters" : "full filters"}</p>,
}));
vi.mock("@/app/(admin)/admin/activity/ActivityFeedTable", () => ({
  default: ({ limited }: { limited?: boolean }) => <p>{limited ? "limited table" : "full table"}</p>,
}));

function renderTab(features: readonly StaffFeature[], total = 1) {
  render(
    <MemberDetails
      initialTab="activity"
      features={features}
      member={{
        id: "mbr_AAAAAAAAAAA1",
        name: "Ada Example",
        displayName: null,
        email: "ada@example.test",
        status: "active",
        kajabiId: null,
        stripeCustomerId: null,
        firstJoinedAt: null,
        mostRecentJoinedAt: null,
        totalActiveMonths: 0,
        metrics: null,
        engagement: null,
      }}
      attendanceRecords={[]}
      hiatusHistory={[]}
      slackPage={{ rows: [], total: 0, page: 1, pageSize: 50, kind: "all", channel: null, channels: [] }}
      slackSummary={{ total: 0, messages: 0, reactions: 0, channels: 0, last30Days: 0 }}
      activityFeed={{ rows: [], total, page: 1, pageSize: 50 }}
      activityFilters={{ view: "all", kinds: null, actorUserId: null, memberId: "mbr_AAAAAAAAAAA1", sudoOnly: false, hideSystem: false, hideSlack: false, days: 90 }}
      currentUserId={null}
      noteEditMinutes={15}
      latestNote={null}
      membershipHistory={[]}
      earnedBadges={[]}
      awardableBadgeTypes={[]}
      awards={[]}
      nameAliases={[]}
      emailAliases={[]}
    />
  );
}

describe("MemberDetails Activity tab", () => {
  it("gives an admin the whole log: the central log link, the full filters and the note form", () => {
    renderTab(STAFF_FEATURES);
    expect(screen.getByRole("tab", { name: "Activity Log" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open in the central log" })).toBeInTheDocument();
    expect(screen.getByText("full filters")).toBeInTheDocument();
    expect(screen.getByText("full table")).toBeInTheDocument();
    expect(screen.getByText("note form")).toBeInTheDocument();
  });

  it("gives a community manager the limited tab: a plain line, no central log link, no note form, the limited filters and table", () => {
    renderTab(COMMUNITY_MANAGER_FEATURES);
    expect(screen.getByRole("tab", { name: "Activity Log" })).toBeInTheDocument();
    expect(screen.getByText(/Changes staff made to their record are not shown/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open in the central log" })).toBeNull();
    expect(screen.queryByText("note form")).toBeNull();
    expect(screen.getByText("limited filters")).toBeInTheDocument();
    expect(screen.getByText("limited table")).toBeInTheDocument();
  });

  it("says when nothing is in the window, in her tab too", () => {
    renderTab(COMMUNITY_MANAGER_FEATURES, 0);
    expect(screen.getByText(/Nothing in this window/)).toBeInTheDocument();
  });

  it("shows neither the tab nor its content to a role without either feature, even when the route opened on it", () => {
    renderTab([]);
    expect(screen.queryByRole("tab", { name: "Activity Log" })).toBeNull();
    expect(screen.queryByText("limited table")).toBeNull();
    expect(screen.queryByText("full table")).toBeNull();
  });
});
