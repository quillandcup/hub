// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ADMIN_USER, renderServerPage, resetServerPageMocks, signInAs } from "@/tests/helpers/server-page";
import { HOSTING_HEAVY } from "@/lib/data/profiles/index";
import { buildDataset } from "@/lib/data/seed-profile";
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

const NOW = new Date("2026-06-30T16:00:00Z");

beforeEach(() => {
  resetServerPageMocks();
  signInAs(ADMIN_USER);
});

describe("community stats page", () => {
  it("ranks hosts and types from the prickles in the chosen range", async () => {
    const dataset = buildDataset(HOSTING_HEAVY, NOW, { timeZone: "America/New_York" });
    repos = createInMemoryRepos(dataset);
    const hana = dataset.members.find((m) => m.name === "Hana Hostess")!;
    const hosted = dataset.prickles.filter((p) => p.hostId === hana.id && p.startTime >= "2026-06-01" && p.startTime < "2026-07-01").length;

    await renderServerPage(CommunityStatsPage, { searchParams: Promise.resolve({ from: "2026-06-01", to: "2026-06-30" }) });

    const charts = JSON.parse(screen.getByTestId("charts").textContent!);
    expect(hosted).toBeGreaterThan(8);
    expect(charts.topHosts[0]).toEqual({ name: "Hana Hostess", count: hosted }); // she hosts five slots of seven
    expect(JSON.stringify(charts.prickleTypes)).toContain("Heads Down Prickle");
  });
});
