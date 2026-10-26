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
vi.mock("@/app/(admin)/admin/stats/DateRangeFilter", () => ({ default: () => null }));
vi.mock("@/app/(admin)/admin/stats/CommunityStatsCharts", () => ({
  default: (props: { topHosts: unknown[]; prickleTypes: unknown[] }) => (
    <pre data-testid="charts">{JSON.stringify({ topHosts: props.topHosts, prickleTypes: props.prickleTypes })}</pre>
  ),
}));

import CommunityStatsPage from "@/app/(admin)/admin/stats/page";

const WRITING = { id: "prty_AAAAAAAAAAA1", name: "Sprint", normalizedName: "sprint", purpose: "writing", requiresHost: true, soloTaskFriendly: false, isSpecialty: false };
const ADA = { id: "mbr_AAAAAAAAAAA1", name: "Ada Example" };
const FERN = { id: "mbr_AAAAAAAAAAA2", name: "Fern Example" };
const day = (d: number) => new Date(Date.UTC(2026, 5, d, 14)).toISOString();
const prickle = (id: string, hostId: string | null, d: number) => ({
  id,
  typeId: WRITING.id,
  hostId,
  title: null,
  startTime: day(d),
  endTime: day(d + 0),
  source: "calendar",
  calendarEventId: null,
});

beforeEach(() => {
  resetServerPageMocks();
  signInAs(ADMIN_USER);
  useFakeSupabase({});
});

describe("community stats page", () => {
  it("ranks hosts and types from the prickles in the chosen range", async () => {
    repos = createInMemoryRepos(
      new InMemoryDataset({
        members: [ADA, FERN],
        prickleTypes: [WRITING],
        prickles: [prickle("prkl_AAAAAAAAAAA1", ADA.id, 10), prickle("prkl_AAAAAAAAAAA2", ADA.id, 11), prickle("prkl_AAAAAAAAAAA3", null, 12)],
        attendance: [
          { id: "att_1", memberId: FERN.id, prickleId: "prkl_AAAAAAAAAAA1", joinTime: day(10), leaveTime: day(10) },
          { id: "att_2", memberId: FERN.id, prickleId: "prkl_AAAAAAAAAAA2", joinTime: day(11), leaveTime: day(11) },
        ],
      }),
    );

    await renderServerPage(CommunityStatsPage, { searchParams: Promise.resolve({ from: "2026-06-01", to: "2026-06-30" }) });

    const charts = JSON.parse(screen.getByTestId("charts").textContent!);
    expect(charts.topHosts).toEqual([{ name: ADA.name, count: 2 }]); // the hostless prickle has no name to rank
    expect(JSON.stringify(charts.prickleTypes)).toContain("Sprint");
  });
});
