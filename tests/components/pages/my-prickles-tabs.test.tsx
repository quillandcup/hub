// @vitest-environment jsdom
/**
 * The standalone /hosting and /calendar pages were removed in favor of My Prickles tabs (and /prickle-picker in
 * favor of Find a Prickle, covered in unflagged-pages.test.tsx). These check each tab's route
 * (/my-prickles/<tab>, lib/tab-routes.ts) serves that content when linked to directly, and that
 * legacy ?tab= links redirect there.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import {
  MEMBER_IDENTITY,
  MEMBER_USER,
  expectRedirect,
  renderServerRoute,
  resetServerPageMocks,
  signInAs,
  useFakeSupabase,
} from "@/tests/helpers/server-page";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/sudo", () => import("@/tests/helpers/server-page").then((m) => m.sudoModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));

// My Prickles data dependencies and heavy client children.
vi.mock("@/lib/upcoming-prickles", () => ({ PRIORITY: { none: 6 }, getRankedUpcomingPrickles: vi.fn(async () => []) }));
vi.mock("@/lib/prickle-schedule", () => ({
  getPrickleScheduleOverview: vi.fn(async () => ({ rows: [], instances: [] })),
}));
vi.mock("@/app/(member)/hosting/actions", () => ({
  getMySchedules: vi.fn(async () => []),
  getMyHostingStats: vi.fn(async () => ({ totalHosted: 0 })),
  getMyHostEligibility: vi.fn(async () => null),
}));
vi.mock("@/app/(member)/my-prickles/commitment-actions", () => ({ getMyCommitments: vi.fn(async () => []) }));
vi.mock("@/app/(member)/my-prickles/calendar-feed-actions", () => ({
  getMyCalendarFeedUrls: vi.fn(async () => ({
    https: "https://hub.example/api/calendar/feed/t.ics",
    webcal: "webcal://hub.example/api/calendar/feed/t.ics",
    google: "https://calendar.google.com/calendar/r?cid=x",
    outlook: "https://outlook.live.com/calendar/0/addfromweb?url=x",
  })),
  regenerateMyCalendarFeedToken: vi.fn(),
  getMyCalendarItems: vi.fn(async () => []),
}));
vi.mock("@/components/MemberCalendarClient", () => ({
  default: ({ memberId }: { memberId: string }) => <div data-testid="history-calendar">member: {memberId}</div>,
}));
vi.mock("@/components/UpcomingPrickleRow", () => ({ default: () => <div /> }));
vi.mock("@/app/(member)/prickle-picker/PrickleWizard", () => ({ default: () => <div data-testid="prickle-wizard" /> }));
vi.mock("@/app/(member)/hosting/HostingStats", () => ({ default: () => <div data-testid="hosting-stats" /> }));
vi.mock("@/app/(member)/hosting/HostingScheduleManager", () => ({
  default: () => <div data-testid="hosting-schedule-manager" />,
}));
vi.mock("@/app/(member)/my-prickles/AllPricklesView", () => ({
  default: ({ initialCommitKeys }: { initialCommitKeys?: string[] | null }) => (
    <div data-testid="all-prickles">commit: {JSON.stringify(initialCommitKeys ?? null)}</div>
  ),
}));
vi.mock("@/app/(member)/my-prickles/CommitmentsManager", () => ({
  default: () => <div data-testid="commitments-manager" />,
}));

import MyPricklesIndex from "@/app/(member)/my-prickles/page";
import AllPricklesRoute from "@/app/(member)/my-prickles/all/page";
import CommitmentsRoute from "@/app/(member)/my-prickles/commitments/page";
import HostingRoute from "@/app/(member)/my-prickles/hosting/page";
import HistoryRoute from "@/app/(member)/my-prickles/history/page";
import { getMyHostEligibility } from "@/app/(member)/hosting/actions";

const routeProps = (searchParams: Record<string, string> = {}) => ({
  params: Promise.resolve({}),
  searchParams: Promise.resolve(searchParams),
});
const renderTab = (Route: (props: never) => React.ReactNode) => renderServerRoute(Route, undefined as never);

beforeEach(() => {
  resetServerPageMocks();
  signInAs(MEMBER_USER, MEMBER_IDENTITY);
  useFakeSupabase();
});

describe("My Prickles tabs that replaced standalone pages", () => {
  it("/my-prickles/hosting opens Hosting with stats and the schedule manager (was /hosting)", async () => {
    await renderTab(HostingRoute);
    expect(screen.getByRole("tab", { name: "Hosting" })).toHaveAttribute("aria-selected", "true");
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByTestId("hosting-stats")).toBeInTheDocument();
    expect(within(panel).getByTestId("hosting-schedule-manager")).toBeInTheDocument();
  });

  it("/my-prickles/history opens the effective member's attendance calendar (was /calendar)", async () => {
    await renderServerRoute(HistoryRoute, routeProps());
    expect(screen.getByRole("tab", { name: "Attendance History" })).toHaveAttribute("aria-selected", "true");
    expect(within(screen.getByRole("tabpanel")).getByTestId("history-calendar")).toHaveTextContent(
      `member: ${MEMBER_IDENTITY.memberId}`
    );
  });
});

describe("My Prickles tab order", () => {
  it("puts Attendance History last", async () => {
    await renderServerRoute(MyPricklesIndex, routeProps());
    const tabs = screen.getAllByRole("tab");
    expect(tabs[tabs.length - 1]).toHaveTextContent("Attendance History");
  });
});

describe("My Prickles Hosting tab for members who can't host yet", () => {
  it("hides the hosting stats banner when they'd see \"Settle in first\"", async () => {
    vi.mocked(getMyHostEligibility).mockResolvedValueOnce({
      eligible: false,
      tenureStartDate: "2026-09-01",
      eligibleOn: "2026-10-01",
    } as any);
    await renderTab(HostingRoute);
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).queryByTestId("hosting-stats")).not.toBeInTheDocument();
    expect(within(panel).queryByRole("heading", { name: /Sync your prickles/ })).not.toBeInTheDocument();
    expect(within(panel).getByTestId("hosting-schedule-manager")).toBeInTheDocument();
  });
});

describe("My Prickles calendar sync", () => {
  it("offers calendar sync on the Commitments tab", async () => {
    await renderTab(CommitmentsRoute);
    expect(
      within(screen.getByRole("tabpanel")).getByRole("heading", { name: "Sync your prickles with your calendar" })
    ).toBeInTheDocument();
  });

  it("offers calendar sync on the Hosting tab", async () => {
    await renderTab(HostingRoute);
    expect(
      within(screen.getByRole("tabpanel")).getByRole("heading", { name: "Sync your prickles with your calendar" })
    ).toBeInTheDocument();
  });
});

describe("My Prickles commitment links", () => {
  it("/my-prickles/commitments lists commitments", async () => {
    await renderTab(CommitmentsRoute);
    expect(screen.getByRole("tab", { name: "Commitments" })).toHaveAttribute("aria-selected", "true");
    expect(within(screen.getByRole("tabpanel")).getByTestId("commitments-manager")).toBeInTheDocument();
  });

  it("/my-prickles/all opens All Prickles with commit mode closed", async () => {
    await renderServerRoute(AllPricklesRoute, routeProps());
    expect(within(screen.getByRole("tabpanel")).getByTestId("all-prickles")).toHaveTextContent("commit: null");
  });

  it("?commit=<keys> opens All Prickles in commit mode with those slots picked", async () => {
    await renderServerRoute(AllPricklesRoute, routeProps({ commit: "t1:1-05:00,t1:3-05:00" }));
    expect(screen.getByRole("tab", { name: "All Prickles" })).toHaveAttribute("aria-selected", "true");
    expect(within(screen.getByRole("tabpanel")).getByTestId("all-prickles")).toHaveTextContent(
      'commit: ["t1:1-05:00","t1:3-05:00"]'
    );
  });

  it("an empty ?commit= opens commit mode with nothing picked", async () => {
    await renderServerRoute(AllPricklesRoute, routeProps({ commit: "" }));
    expect(within(screen.getByRole("tabpanel")).getByTestId("all-prickles")).toHaveTextContent("commit: []");
  });

  it("the older ?tab=commitments&slot=<key> link redirects to All Prickles with that slot picked", async () => {
    await expectRedirect(
      MyPricklesIndex,
      routeProps({ tab: "commitments", slot: "t1:1-07:00" }),
      "/my-prickles/all?commit=t1%3A1-07%3A00"
    );
  });
});

describe("My Prickles legacy ?tab= links", () => {
  it("redirect to the tab's path, keeping other params", async () => {
    await expectRedirect(MyPricklesIndex, routeProps({ tab: "history" }), "/my-prickles/history");
    await expectRedirect(MyPricklesIndex, routeProps({ tab: "all", commit: "" }), "/my-prickles/all?commit=");
  });

  it("send the first tab to the bare path, and ignore an unknown tab", async () => {
    await expectRedirect(MyPricklesIndex, routeProps({ tab: "upcoming" }), "/my-prickles");
    await renderServerRoute(MyPricklesIndex, routeProps({ tab: "bogus" }));
    expect(screen.getByRole("tab", { name: "Upcoming" })).toHaveAttribute("aria-selected", "true");
  });
});
