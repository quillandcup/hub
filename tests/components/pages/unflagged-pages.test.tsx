// @vitest-environment jsdom
/**
 * Streaks, Prickle Picker and Wheel of Wonder used to sit behind feature flags. They're now on for
 * everyone, so a signed-in member with NO feature previews must get the page, not a redirect. The
 * fake Supabase client has no feature_flags / user_feature_previews / segment rows, so a re-added
 * gate via lib/features.server would see an empty flag set and redirect -- which these tests catch.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ADMIN_USER,
  MEMBER_IDENTITY,
  MEMBER_USER,
  expectRedirect,
  redirect,
  renderServerPage,
  resetServerPageMocks,
  signInAs,
  useFakeSupabase,
  type FakeQuery,
} from "@/tests/helpers/server-page";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/sudo", () => import("@/tests/helpers/server-page").then((m) => m.sudoModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));

// Heavy client children: stubbed to a marker so the page's own wiring is what's under test.
vi.mock("@/app/(member)/wheel-of-wonder/Wheel", () => ({
  default: ({ confirmedConnectionCount }: { confirmedConnectionCount: number }) => (
    <div data-testid="wheel">connections: {confirmedConnectionCount}</div>
  ),
}));
vi.mock("@/app/(member)/prickle-picker/PrickleWizard", () => ({
  default: ({ members }: { members: { id: string; name: string }[] }) => (
    <div data-testid="prickle-wizard">{members.map((m) => m.name).join(", ")}</div>
  ),
}));

// My Prickles data dependencies.
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
vi.mock("@/components/MemberCalendarClient", () => ({ default: () => <div data-testid="history-calendar" /> }));
vi.mock("@/components/UpcomingPrickleRow", () => ({
  default: ({ prickle }: { prickle: { id: string } }) => <div data-testid="upcoming-row">{prickle.id}</div>,
}));
vi.mock("@/app/(member)/hosting/HostingStats", () => ({ default: () => <div data-testid="hosting-stats" /> }));
vi.mock("@/app/(member)/hosting/HostingScheduleManager", () => ({ default: () => <div /> }));
vi.mock("@/app/(member)/my-prickles/AllPricklesView", () => ({ default: () => <div data-testid="all-prickles" /> }));
vi.mock("@/app/(member)/my-prickles/CommitmentsManager", () => ({ default: () => <div /> }));

import StreaksPage from "@/app/(member)/streaks/page";
import WheelOfWonderPage from "@/app/(member)/wheel-of-wonder/page";
import AdminWheelOfWonderPage from "@/app/(admin)/admin/wheel-of-wonder/page";
import MyPricklesPage from "@/app/(member)/my-prickles/page";
import { getRankedUpcomingPrickles } from "@/lib/upcoming-prickles";

const OTHER_MEMBERS = [
  { id: "member-fern", name: "Fern Quillsby", email: "fern.quillsby@example.test" },
  { id: "member-hazel", name: "Hazel Burrowes", email: "hazel.burrowes@example.test" },
];

// Roles keyed by the queried user id, so only ADMIN_USER resolves to an admin profile.
const ROLES: Record<string, string> = { [ADMIN_USER.id]: "admin", [MEMBER_USER.id]: "member" };
const userProfiles = (q: FakeQuery) => {
  const id = q.calls.find((c) => c.method === "eq" && c.args[0] === "id")?.args[1] as string;
  return { data: ROLES[id] ? [{ role: ROLES[id] }] : [] };
};

const myPricklesProps = (tab?: string) => ({ searchParams: Promise.resolve(tab ? { tab } : {}) });

beforeEach(() => {
  resetServerPageMocks();
  signInAs(MEMBER_USER, MEMBER_IDENTITY);
  useFakeSupabase({ members: { data: OTHER_MEMBERS } });
});

describe("retired feature flags: pages render for a member with no feature previews", () => {
  it("Streaks renders", async () => {
    await renderServerPage(StreaksPage, {});
    expect(screen.getByRole("heading", { name: "Streaks" })).toBeInTheDocument();
    expect(screen.getByText("Your Attendance Streak")).toBeInTheDocument();
    expect(redirect).not.toHaveBeenCalled();
  });

  // The standalone /prickle-picker page was removed; the Prickle Picker lives only in this tab now.
  it("Prickle Picker (My Prickles → Find a Prickle) renders the wizard, excluding the member themselves", async () => {
    await renderServerPage(MyPricklesPage, myPricklesProps("find"));
    const wizard = within(screen.getByRole("tabpanel")).getByTestId("prickle-wizard");
    expect(wizard).toHaveTextContent("Hazel Burrowes");
    expect(wizard).not.toHaveTextContent("Fern Quillsby");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("Wheel of Wonder renders the wheel with the confirmed-connection count", async () => {
    useFakeSupabase({ wheel_of_wonder_matches: { count: 7 } });
    await renderServerPage(WheelOfWonderPage, {});
    expect(screen.getByRole("heading", { name: "Wheel of Wonder" })).toBeInTheDocument();
    expect(screen.getByTestId("wheel")).toHaveTextContent("connections: 7");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("admin Wheel of Wonder renders for an admin without redirecting to /admin", async () => {
    signInAs(ADMIN_USER, null);
    useFakeSupabase({
      user_profiles: userProfiles,
      wheel_of_wonder_matches: {
        data: [
          {
            id: "match-1",
            status: "confirmed",
            created_at: "2026-09-01T15:00:00Z",
            confirmed_at: "2026-09-03T15:00:00Z",
            spinner_message_count: 6,
            matched_message_count: 5,
            spinner: { id: "member-fern", name: "Fern Quillsby" },
            matched: { id: "member-hazel", name: "Hazel Burrowes" },
          },
        ],
      },
    });
    await renderServerPage(AdminWheelOfWonderPage, {});
    expect(screen.getByRole("heading", { name: /Wheel of Wonder/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Hazel Burrowes" })).toHaveAttribute("href", "/admin/members/member-hazel");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("admin Wheel of Wonder sends a non-admin member back to /dashboard without loading matches", async () => {
    const supabase = useFakeSupabase({ user_profiles: userProfiles });
    await expectRedirect(AdminWheelOfWonderPage, {}, "/dashboard");
    expect(supabase.queries.map((q) => q.table)).not.toContain("wheel_of_wonder_matches");
  });

  it("admin Wheel of Wonder blocks a user with no profile row", async () => {
    signInAs({ id: "user-no-profile", email: "nobody@example.test" }, null);
    useFakeSupabase({ user_profiles: userProfiles });
    await expectRedirect(AdminWheelOfWonderPage, {}, "/dashboard");
  });

  it("My Prickles includes the Find a Prickle tab", async () => {
    await renderServerPage(MyPricklesPage, myPricklesProps());
    expect(screen.getByRole("tab", { name: "Find a Prickle" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Upcoming" })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(screen.getByRole("tab", { name: "Find a Prickle" }));
    expect(within(screen.getByRole("tabpanel")).getByTestId("prickle-wizard")).toHaveTextContent("Hazel Burrowes");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("My Prickles honors ?tab=find", async () => {
    await renderServerPage(MyPricklesPage, myPricklesProps("find"));
    expect(screen.getByRole("tab", { name: "Find a Prickle" })).toHaveAttribute("aria-selected", "true");
    expect(within(screen.getByRole("tabpanel")).getByTestId("prickle-wizard")).toBeInTheDocument();
  });

  it("My Prickles' Upcoming overflow note links to Find a Prickle", async () => {
    const ranked = Array.from({ length: 9 }, (_, i) => ({ prickle: { id: `prickle-${i}` }, reasons: [] }));
    vi.mocked(getRankedUpcomingPrickles).mockResolvedValueOnce(ranked as never);
    await renderServerPage(MyPricklesPage, myPricklesProps());
    expect(screen.getAllByTestId("upcoming-row")).toHaveLength(8);
    expect(screen.getByRole("link", { name: /Find a Prickle/ })).toHaveAttribute("href", "/my-prickles?tab=find");
  });
});

describe("sudo requirement is kept", () => {
  it.each([
    ["Streaks", StreaksPage, {}],
    ["Wheel of Wonder", WheelOfWonderPage, {}],
    ["My Prickles", MyPricklesPage, myPricklesProps("find")],
  ] as const)("%s redirects a user with no effective member identity to /admin", async (_name, Page, props) => {
    signInAs(ADMIN_USER, null);
    await expectRedirect(Page as (p: typeof props) => Promise<React.ReactNode>, props, "/admin");
  });

  it("redirects a signed-out visitor to /login", async () => {
    signInAs(null);
    await expectRedirect(StreaksPage, {}, "/login");
  });
});
