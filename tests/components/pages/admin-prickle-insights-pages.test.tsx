// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ADMIN_USER, renderServerPage, resetServerPageMocks, signInAs, useFakeSupabase } from "@/tests/helpers/server-page";
import { InMemoryAttendanceRepository } from "@/lib/data/attendance";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
vi.mock("@/lib/admin-auth", () => ({ requireAdminPage: vi.fn(async () => undefined) }));
// Attendance comes from its repository; the pages get an in-memory one seeded per test.
let attendance = new InMemoryAttendanceRepository();
vi.mock("@/lib/data/repos", async () => {
  const actual = await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos");
  const { InMemoryDataset } = await import("@/lib/data/in-memory");
  return {
    ...actual,
    createRepos: () => ({
      ...actual.createInMemoryRepos(new InMemoryDataset({ members: [{ id: "mbr_AAAAAAAAAAA1", name: "Ada Example" }] })),
      attendance,
    }),
  };
});
vi.mock("@/app/(admin)/admin/insights/prickles/[kind]/GroupedTable", () => ({
  default: ({ rows }: { rows: unknown[] }) => <pre data-testid="grouped">{JSON.stringify(rows.length)}</pre>,
}));

import PrickleInsightsPage from "@/app/(admin)/admin/insights/prickles/page";
import PrickleKindInsightsPage from "@/app/(admin)/admin/insights/prickles/[kind]/page";

const TYPE = { id: "ptyp_AAAAAAAAAAA1", name: "Sprint Writing", normalized_name: "sprint-writing" };
const PAST = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const PRICKLES = [
  { id: "prkl_AAAAAAAAAAA1", type_id: TYPE.id, start_time: PAST(10), host: { id: "mbr_AAAAAAAAAAA1", name: "Ada Example" } },
  { id: "prkl_AAAAAAAAAAA2", type_id: TYPE.id, start_time: PAST(3), host: { id: "mbr_AAAAAAAAAAA1", name: "Ada Example" } },
];
const row = (id: string, memberId: string, prickleId: string) => ({ id, memberId, prickleId, joinTime: PAST(3), leaveTime: PAST(3) });

beforeEach(() => {
  resetServerPageMocks();
  signInAs(ADMIN_USER);
  attendance = new InMemoryAttendanceRepository([
    row("a1", "mbr_AAAAAAAAAAA2", PRICKLES[0].id),
    row("a2", "mbr_AAAAAAAAAAA3", PRICKLES[0].id),
    row("a3", "mbr_AAAAAAAAAAA2", PRICKLES[1].id),
  ]);
  useFakeSupabase({
    prickle_types: { data: [TYPE] },
    prickles: { data: PRICKLES },
    members: { data: [{ id: "mbr_AAAAAAAAAAA1", name: "Ada Example" }] },
  });
});

describe("prickle insights page", () => {
  it("scores each type from the attendance repository", async () => {
    const all = vi.spyOn(attendance, "list");

    await renderServerPage(PrickleInsightsPage, { searchParams: Promise.resolve({}) });

    expect(all).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "Prickle Insights" })).toBeInTheDocument();
    expect(screen.getByText("Sprint Writing")).toBeInTheDocument();
  });
});

describe("prickle kind insights page", () => {
  it("asks the repository for the attendance of that type's prickles only", async () => {
    const forPrickles = vi.spyOn(attendance, "forPrickles");

    await renderServerPage(PrickleKindInsightsPage, {
      params: Promise.resolve({ kind: TYPE.normalized_name }),
      searchParams: Promise.resolve({}),
    });

    expect(forPrickles).toHaveBeenCalledWith(PRICKLES.map((p) => p.id));
    expect(screen.getByRole("heading", { name: "Sprint Writing" })).toBeInTheDocument();
    expect(screen.getByTestId("grouped")).toBeInTheDocument();
  });
});
