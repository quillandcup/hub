// @vitest-environment jsdom
/**
 * The standalone /hosting and /calendar pages were removed in favor of My Prickles tabs (and /prickle-picker in
 * favor of Find a Prickle, covered in unflagged-pages.test.tsx). These check each tab serves that content when
 * linked to directly via `?tab=`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import {
  MEMBER_IDENTITY,
  MEMBER_USER,
  renderServerPage,
  resetServerPageMocks,
  signInAs,
  useFakeSupabase,
} from "@/tests/helpers/server-page";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/sudo", () => import("@/tests/helpers/server-page").then((m) => m.sudoModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));

// My Prickles data dependencies and heavy client children.
vi.mock("@/lib/upcoming-prickles", () => ({ getRankedUpcomingPrickles: vi.fn(async () => []) }));
vi.mock("@/lib/prickle-schedule", () => ({
  getPrickleScheduleOverview: vi.fn(async () => ({ rows: [], instances: [] })),
}));
vi.mock("@/app/(member)/hosting/actions", () => ({
  getMySchedules: vi.fn(async () => []),
  getMyHostingStats: vi.fn(async () => ({ totalHosted: 0 })),
  getMyHostEligibility: vi.fn(async () => null),
}));
vi.mock("@/app/(member)/my-prickles/commitment-actions", () => ({ getMyCommitments: vi.fn(async () => []) }));
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

import MyPricklesPage from "@/app/(member)/my-prickles/page";

const props = (tab: string, extra: Record<string, string> = {}) => ({
  searchParams: Promise.resolve({ tab, ...extra }),
});

beforeEach(() => {
  resetServerPageMocks();
  signInAs(MEMBER_USER, MEMBER_IDENTITY);
  useFakeSupabase();
});

describe("My Prickles tabs that replaced standalone pages", () => {
  it("?tab=hosting opens Hosting with stats and the schedule manager (was /hosting)", async () => {
    await renderServerPage(MyPricklesPage, props("hosting"));
    expect(screen.getByRole("tab", { name: "Hosting" })).toHaveAttribute("aria-selected", "true");
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByTestId("hosting-stats")).toBeInTheDocument();
    expect(within(panel).getByTestId("hosting-schedule-manager")).toBeInTheDocument();
  });

  it("?tab=history opens the effective member's attendance calendar (was /calendar)", async () => {
    await renderServerPage(MyPricklesPage, props("history"));
    expect(screen.getByRole("tab", { name: "Attendance History" })).toHaveAttribute("aria-selected", "true");
    expect(within(screen.getByRole("tabpanel")).getByTestId("history-calendar")).toHaveTextContent(
      `member: ${MEMBER_IDENTITY.memberId}`
    );
  });
});

describe("My Prickles commitment links", () => {
  it("?tab=commitments lists commitments", async () => {
    await renderServerPage(MyPricklesPage, props("commitments"));
    expect(screen.getByRole("tab", { name: "Commitments" })).toHaveAttribute("aria-selected", "true");
    expect(within(screen.getByRole("tabpanel")).getByTestId("commitments-manager")).toBeInTheDocument();
  });

  it("?tab=all opens All Prickles with commit mode closed", async () => {
    await renderServerPage(MyPricklesPage, props("all"));
    expect(within(screen.getByRole("tabpanel")).getByTestId("all-prickles")).toHaveTextContent("commit: null");
  });

  it("?commit=<keys> opens All Prickles in commit mode with those slots picked", async () => {
    await renderServerPage(MyPricklesPage, props("all", { commit: "t1:1-05:00,t1:3-05:00" }));
    expect(screen.getByRole("tab", { name: "All Prickles" })).toHaveAttribute("aria-selected", "true");
    expect(within(screen.getByRole("tabpanel")).getByTestId("all-prickles")).toHaveTextContent(
      'commit: ["t1:1-05:00","t1:3-05:00"]'
    );
  });

  it("an empty ?commit= opens commit mode with nothing picked", async () => {
    await renderServerPage(MyPricklesPage, props("all", { commit: "" }));
    expect(within(screen.getByRole("tabpanel")).getByTestId("all-prickles")).toHaveTextContent("commit: []");
  });

  it("the older ?tab=commitments&slot=<key> link lands on All Prickles with that slot picked", async () => {
    await renderServerPage(MyPricklesPage, props("commitments", { slot: "t1:1-07:00" }));
    expect(screen.getByRole("tab", { name: "All Prickles" })).toHaveAttribute("aria-selected", "true");
    expect(within(screen.getByRole("tabpanel")).getByTestId("all-prickles")).toHaveTextContent('commit: ["t1:1-07:00"]');
  });
});
