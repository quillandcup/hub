// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ADMIN_USER, renderServerPage, resetServerPageMocks, signInAs } from "@/tests/helpers/server-page";
import { InMemoryAttendanceRepository } from "@/lib/data/attendance";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
const requireAdminPage = vi.fn(async () => undefined);
vi.mock("@/lib/admin-auth", () => ({ requireAdminPage: () => requireAdminPage() }));
let attendance = new InMemoryAttendanceRepository();
vi.mock("@/lib/data/repos", async () => {
  const actual = await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos");
  const { InMemoryDataset } = await import("@/lib/data/in-memory");
  return {
    ...actual,
    // Members (counts by status, names for the top attendees) and the attendance seeded per test.
    createRepos: () => ({ ...actual.createInMemoryRepos(new InMemoryDataset({ members: MEMBERS })), attendance }),
  };
});
// The charts are a client component; here they show what the page hands them.
vi.mock("@/app/(admin)/admin/DashboardCharts", () => ({
  default: (props: { weeklyAttendance: { uniqueAttendees: number; repeatAttendance: number }[]; dailyHours: { hours: number }[] }) => (
    <pre data-testid="charts">
      {JSON.stringify({
        records: props.weeklyAttendance.reduce((n, w) => n + w.uniqueAttendees + w.repeatAttendance, 0),
        hours: props.dailyHours.reduce((n, d) => n + d.hours, 0),
      })}
    </pre>
  ),
}));

import DashboardPage from "@/app/(admin)/admin/page";

const MEMBERS = [
  { id: "mbr_AAAAAAAAAAA1", name: "Ada Example", email: "ada@example.test", status: "active", source: "kajabi" },
  { id: "mbr_AAAAAAAAAAA2", name: "Fern Example", email: "fern@example.test", status: "active", source: "kajabi" },
];
const daysAgo = (days: number, hours = 0) => new Date(Date.now() - days * 86_400_000 - hours * 3_600_000).toISOString();
// One hour each. Ada: 40 days ago (outside 30d, inside 8 weeks), 20 days ago, 2 days ago. Fern: 20 days ago.
const record = (id: string, memberId: string, days: number) => ({
  id,
  memberId,
  prickleId: "prkl_AAAAAAAAAAA1",
  joinTime: daysAgo(days, 1),
  leaveTime: daysAgo(days),
});

beforeEach(() => {
  resetServerPageMocks();
  signInAs(ADMIN_USER);
  requireAdminPage.mockClear();
  attendance = new InMemoryAttendanceRepository([
    record("a1", MEMBERS[0].id, 40),
    record("a2", MEMBERS[0].id, 20),
    record("a3", MEMBERS[0].id, 2),
    record("a4", MEMBERS[1].id, 20),
  ]);
});

describe("admin dashboard page", () => {
  it("is for admins", async () => {
    await renderServerPage(DashboardPage, {});
    expect(requireAdminPage).toHaveBeenCalledTimes(1);
  });

  it("slices one 8-week read into the 30-day hours and the 7-day engagement", async () => {
    const window = vi.spyOn(attendance, "joinedBetween");

    await renderServerPage(DashboardPage, {});

    expect(window).toHaveBeenCalledTimes(1); // one read serves the 8-week, 30-day and 7-day figures
    // Only Ada attended in the last 7 days.
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("1 of 2 active members")).toBeInTheDocument();
    // 30 days: Ada 2h, Fern 1h, so the median of [1, 2] is 1.5 and the average 1.5.
    expect(screen.getByText("per member • 1.5 avg")).toBeInTheDocument();
    // The chart gets all four records in 8 weeks, and the three inside 30 days as hours.
    expect(JSON.parse(screen.getByTestId("charts").textContent!)).toEqual({ records: 4, hours: 3 });
  });

  it("ranks the top attendees by their number of attendance records", async () => {
    await renderServerPage(DashboardPage, {});

    const heading = screen.getByText("🌟 Top Attendees");
    const list = heading.nextElementSibling!;
    expect(list.textContent).toMatch(/1Ada Example/);
    expect(list.textContent).toMatch(/2Fern Example/);
  });
});
