// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ADMIN_USER, renderServerPage, resetServerPageMocks, signInAs, useFakeSupabase } from "@/tests/helpers/server-page";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
vi.mock("@/lib/admin-auth", () => ({ requireAdminPage: vi.fn(async () => undefined) }));
let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));
vi.mock("@/app/(admin)/admin/hygiene/name-matching/MatchingGame", () => ({
  default: ({ membersWithNoAttendance }: { membersWithNoAttendance: unknown[] }) => (
    <pre data-testid="never-attended">{JSON.stringify(membersWithNoAttendance)}</pre>
  ),
}));

import AtRiskPage from "@/app/(admin)/admin/at-risk/page";
import NameMatchingPage from "@/app/(admin)/admin/hygiene/name-matching/page";

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const member = (n: number, extra: object = {}) => ({
  id: `mbr_AAAAAAAAAAA${n}`,
  name: `Member ${String.fromCharCode(64 + n)} Example`,
  email: `m${n}@example.test`,
  joinedAt: "2025-01-02",
  ...extra,
});
const attended = (id: string, memberId: string, days: number) => ({
  id,
  memberId,
  prickleId: "prkl_AAAAAAAAAAA1",
  joinTime: daysAgo(days),
  leaveTime: daysAgo(days),
});

beforeEach(() => {
  resetServerPageMocks();
  signInAs(ADMIN_USER);
  useFakeSupabase({});
});

describe("at-risk page", () => {
  it("lists active members with no attendance in 30 days, longest absent first, never staff-only or inactive ones", async () => {
    const recent = member(1);
    const lapsed = member(2);
    const longLapsed = member(3);
    const never = member(4);
    const staffOnly = member(5, { source: "staff" });
    const onHiatus = member(6, { status: "on_hiatus" });
    repos = createInMemoryRepos(
      new InMemoryDataset({
        members: [recent, lapsed, longLapsed, never, staffOnly, onHiatus],
        attendance: [
          attended("att_1", recent.id, 3),
          attended("att_2", lapsed.id, 45),
          attended("att_3", lapsed.id, 60),
          attended("att_4", longLapsed.id, 200),
        ],
      }),
    );

    await renderServerPage(AtRiskPage, {});

    const order = screen.getAllByRole("link").map((a) => a.textContent).filter((t) => t?.endsWith("Example"));
    // Never attended first, then the longest absent.
    expect(order).toEqual([never.name, longLapsed.name, lapsed.name]);
    expect(screen.queryByText(recent.name)).not.toBeInTheDocument();
    expect(screen.queryByText(staffOnly.name)).not.toBeInTheDocument();
    expect(screen.queryByText(onHiatus.name)).not.toBeInTheDocument();
  });
});

describe("name matching page", () => {
  it("offers the active members who have never attended", async () => {
    const ada = member(1);
    const fern = member(2);
    const cancelled = member(3, { status: "cancelled" });
    repos = createInMemoryRepos(
      new InMemoryDataset({ members: [ada, fern, cancelled], attendance: [attended("att_1", ada.id, 5)] }),
    );

    await renderServerPage(NameMatchingPage, {});

    const shown = JSON.parse(screen.getByTestId("never-attended").textContent!);
    expect(shown).toEqual([expect.objectContaining({ id: fern.id, name: fern.name, email: fern.email })]);
  });
});

describe("at-risk page display names", () => {
  it("shows the display name first with the legal name beside it", async () => {
    const m = member(1, { displayName: "Ada E" });
    repos = createInMemoryRepos(new InMemoryDataset({ members: [m], attendance: [] }));

    await renderServerPage(AtRiskPage, {});

    expect(screen.getByRole("link", { name: "Ada E" })).toBeInTheDocument();
    expect(screen.getByText(m.name)).toBeInTheDocument();
  });
});
