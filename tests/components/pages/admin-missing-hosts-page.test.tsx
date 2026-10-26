// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderServerPage, resetServerPageMocks, useFakeSupabase } from "@/tests/helpers/server-page";
import { InMemoryDataset } from "@/lib/data/in-memory";
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
    repos = createInMemoryRepos(
      new InMemoryDataset({
        members: [{ id: "mbr_AAAAAAAAAAA1", name: "Ada Example" }],
        prickleTypes: [{ id: "t1", name: "Sprint", normalizedName: "sprint", purpose: "writing", requiresHost: true, soloTaskFriendly: false, isSpecialty: false }],
        prickles: [{ id: "p1", typeId: "t1", hostId: null, title: null, source: "calendar", calendarEventId: null, startTime: "2026-10-19T15:00:00Z", endTime: "2026-10-19T16:00:00Z" }],
      }),
    );

    await renderServerPage(MissingHostsPage, {});

    expect(requireAdminPage).toHaveBeenCalled();
    expect(JSON.parse(screen.getByTestId("props").textContent!)).toEqual({ stats: 1, members: 1 });
  });
});
