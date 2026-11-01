// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ADMIN_USER, renderServerPage, resetServerPageMocks, signInAs } from "@/tests/helpers/server-page";
import { InMemoryAttendanceRepository } from "@/lib/data/attendance";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
vi.mock("@/lib/admin-auth", () => ({ requireAdminPage: vi.fn(async () => undefined) }));
// Prickles, types and members come from the in-memory repositories over a dataset; attendance is a
// separate in-memory repository the tests seed and spy on.
const TYPE = { id: "ptyp_AAAAAAAAAAA1", name: "Sprint Writing", normalizedName: "sprint-writing", purpose: "writing", requiresHost: true, soloTaskFriendly: false, listedInEvents: false, announcedPublicly: false, guestsAllowed: false };
const PAST = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const prickle = (id: string, days: number) => ({
  id,
  typeId: TYPE.id,
  hostId: "mbr_AAAAAAAAAAA1",
  title: null,
  startTime: PAST(days),
  endTime: PAST(days),
  source: "calendar",
  calendarEventId: null,
});
const PRICKLES = [prickle("prkl_AAAAAAAAAAA1", 10), prickle("prkl_AAAAAAAAAAA2", 3)];
// One that hasn't happened yet: it has no attendance, so the page leaves it out.
const FUTURE = prickle("prkl_AAAAAAAAAAA3", -5);
let attendance = new InMemoryAttendanceRepository();
vi.mock("@/lib/data/repos", async () => {
  const actual = await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos");
  const { InMemoryDataset } = await import("@/lib/data/in-memory");
  return {
    ...actual,
    createRepos: () => ({
      ...actual.createInMemoryRepos(
        new InMemoryDataset({ members: [{ id: "mbr_AAAAAAAAAAA1", name: "Ada Example" }], prickleTypes: [TYPE], prickles: [...PRICKLES, FUTURE] }),
      ),
      attendance,
    }),
  };
});
vi.mock("@/app/(admin)/admin/insights/prickles/[kind]/GroupedTable", () => ({
  default: ({ rows }: { rows: unknown[] }) => <pre data-testid="grouped">{JSON.stringify(rows.length)}</pre>,
}));

import PrickleInsightsPage from "@/app/(admin)/admin/insights/prickles/page";
import PrickleKindInsightsPage from "@/app/(admin)/admin/insights/prickles/[kind]/page";

const row = (id: string, memberId: string, prickleId: string) => ({ id, memberId, prickleId, joinTime: PAST(3), leaveTime: PAST(3) });

beforeEach(() => {
  resetServerPageMocks();
  signInAs(ADMIN_USER);
  attendance = new InMemoryAttendanceRepository([
    row("a1", "mbr_AAAAAAAAAAA2", PRICKLES[0].id),
    row("a2", "mbr_AAAAAAAAAAA3", PRICKLES[0].id),
    row("a3", "mbr_AAAAAAAAAAA2", PRICKLES[1].id),
  ]);
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
      params: Promise.resolve({ kind: TYPE.normalizedName }),
      searchParams: Promise.resolve({}),
    });

    expect(forPrickles).toHaveBeenCalledWith(PRICKLES.map((p) => p.id));
    expect(screen.getByRole("heading", { name: "Sprint Writing" })).toBeInTheDocument();
    expect(screen.getByTestId("grouped")).toBeInTheDocument();
  });

  it("only counts prickles in the chosen date range", async () => {
    const forPrickles = vi.spyOn(attendance, "forPrickles");
    const from = PAST(5).slice(0, 10);

    await renderServerPage(PrickleKindInsightsPage, {
      params: Promise.resolve({ kind: TYPE.normalizedName }),
      searchParams: Promise.resolve({ from }),
    });

    expect(forPrickles).toHaveBeenCalledWith([PRICKLES[1].id]);
  });

  it("is not found for a type that doesn't exist", async () => {
    await expect(
      renderServerPage(PrickleKindInsightsPage, { params: Promise.resolve({ kind: "no-such-type" }), searchParams: Promise.resolve({}) }),
    ).rejects.toThrow();
  });
});
