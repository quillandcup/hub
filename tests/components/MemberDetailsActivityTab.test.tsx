// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { STAFF_FEATURES, staffFeaturesFor, type StaffFeature } from "@/lib/staff-access";

const COMMUNITY_MANAGER_FEATURES = staffFeaturesFor("community_manager");
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

const FILTERS = { view: "all", kinds: null, actorUserId: null, memberId: "mbr_AAAAAAAAAAA1", sudoOnly: false, hideSystem: false, hideSlack: false, days: 90 } as const;

function renderTab(features: readonly StaffFeature[], total = 1, filters: Record<string, unknown> = FILTERS) {
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
      activityFilters={filters as never}
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

  it("says when nothing is in the range, and what to try, in her tab too", () => {
    renderTab(COMMUNITY_MANAGER_FEATURES, 0);
    expect(screen.getByText("Nothing in this range. Try a longer one.")).toBeInTheDocument();
    expect(screen.queryByText("limited table")).toBeNull();
  });

  describe("the range, in words", () => {
    const range = { ...FILTERS, range: { from: "2026-11-03", to: "2026-11-17" }, rangeNotice: null };

    it.each([
      ["an admin", STAFF_FEATURES, "full table"],
      ["a community manager", COMMUNITY_MANAGER_FEATURES, "limited table"],
    ])("tells %s the total and the days, with a Clear that keeps the other filters", (_who, features, table) => {
      renderTab(features, 12, { ...range, hideSlack: true });
      expect(screen.getByText(/^12 events, (\d+ \w+( \d{4})?) to (\d+ \w+( \d{4})?)/)).toBeInTheDocument();
      expect(screen.getByText(/3 Nov/)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Clear" })).toHaveAttribute("href", "/admin/members/mbr_AAAAAAAAAAA1/activity?noslack=1");
      expect(screen.getByText(table)).toBeInTheDocument();
    });

    it("says the usual window, with no Clear, when no range was asked for", () => {
      renderTab(STAFF_FEATURES, 1);
      expect(screen.getByText("1 event, last 90 days")).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Clear" })).toBeNull();
    });

    it("shows why a range in the URL was not used, and the usual window it fell back to", () => {
      renderTab(COMMUNITY_MANAGER_FEATURES, 2, { ...FILTERS, range: null, rangeNotice: "The From day was after the To day, so the usual range is shown." });
      expect(screen.getByRole("status")).toHaveTextContent("The From day was after the To day");
      expect(screen.getByText("2 events, last 90 days")).toBeInTheDocument();
    });

    it("sends an admin to the central log with its longest window while a custom range or all time is on", () => {
      renderTab(STAFF_FEATURES, 12, range);
      expect(screen.getByRole("link", { name: "Open in the central log" })).toHaveAttribute("href", expect.stringContaining("days=365"));
      expect(screen.getByRole("link", { name: "Open in the central log" })).not.toHaveAttribute("href", expect.stringContaining("from="));
    });
  });

  it("shows neither the tab nor its content to a role without either feature, even when the route opened on it", () => {
    renderTab([]);
    expect(screen.queryByRole("tab", { name: "Activity Log" })).toBeNull();
    expect(screen.queryByText("limited table")).toBeNull();
    expect(screen.queryByText("full table")).toBeNull();
  });
});
