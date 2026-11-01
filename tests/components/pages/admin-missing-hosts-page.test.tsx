// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderServerPage, resetServerPageMocks, useFakeSupabase } from "@/tests/helpers/server-page";
import { HOSTING_HEAVY } from "@/lib/data/profiles/index";
import { buildDataset } from "@/lib/data/seed-profile";
import { createInMemoryRepos } from "@/lib/data/repos";

vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
const requireAdminPage = vi.fn(async () => undefined);
vi.mock("@/lib/admin-auth", () => ({ requireAdminPage: () => requireAdminPage() }));
let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));
vi.mock("@/app/(admin)/admin/data-health/missing-hosts/MissingHostsClient", () => ({
  default: (props: { stats: unknown[]; members: unknown[] }) => <pre data-testid="props">{JSON.stringify({ stats: props.stats.length, members: props.members.length })}</pre>,
}));

import MissingHostsPage from "@/app/(admin)/admin/data-health/missing-hosts/page";

beforeEach(() => {
  resetServerPageMocks();
  useFakeSupabase({});
  requireAdminPage.mockClear();
});

describe("prickles missing hosts page", () => {
  it("checks the visitor is an admin, then hands the client what it shows", async () => {
    const dataset = buildDataset(HOSTING_HEAVY, new Date(), { timeZone: "America/New_York" });
    for (const prickle of dataset.prickles) if (prickle.hostId) prickle.hostId = null; // nobody hosts anything
    repos = createInMemoryRepos(dataset);

    await renderServerPage(MissingHostsPage, {});

    expect(requireAdminPage).toHaveBeenCalled();
    const props = JSON.parse(screen.getByTestId("props").textContent!);
    expect(props.members).toBe(dataset.members.length);
    expect(props.stats).toBeGreaterThan(0);
  });
});
