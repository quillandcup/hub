// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderServerPage, resetServerPageMocks, useFakeSupabase } from "@/tests/helpers/server-page";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
vi.mock("@/lib/admin-auth", () => ({ requireAdminPage: vi.fn(async () => undefined) }));
vi.mock("@/lib/timezone", () => ({ getViewerTimeZone: vi.fn(async () => "UTC") }));
let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));
vi.mock("@/app/(admin)/admin/reconciliation/ReconciliationClient", () => ({ default: () => null }));
vi.mock("@/components/RecordHistoryButton", () => ({ default: () => null }));
vi.mock("@/app/(admin)/admin/hygiene/ProcessOrphanedButton", () => ({
  default: ({ dateRange }: { dateRange: unknown }) => <p data-testid="orphaned-range">{JSON.stringify(dateRange)}</p>,
}));
vi.mock("@/app/(admin)/admin/hygiene/ProcessOrphanedMeetingsButton", () => ({ default: () => null }));

import DataHygienePage from "@/app/(admin)/admin/hygiene/page";

const TAKES_HOST = { id: "prty_AAAAAAAAAAA1", name: "Sprint", normalizedName: "sprint", purpose: "writing", requiresHost: true, soloTaskFriendly: false, listedInEvents: false, announcedPublicly: false, guestsAllowed: false };
const prickle = (id: string, extra: object) => ({
  id, typeId: TAKES_HOST.id, hostId: null, title: null, source: "calendar",
  startTime: "2026-10-19T15:00:00Z", endTime: "2026-10-19T16:00:00Z", calendarEventId: null, ...extra,
});

beforeEach(() => {
  resetServerPageMocks();
  useFakeSupabase({});
});

describe("data health page", () => {
  it("reports host coverage, and Pop-Up Prickles nobody attended", async () => {
    repos = createInMemoryRepos(
      new InMemoryDataset({
        members: [{ id: "mbr_AAAAAAAAAAA1", name: "Ada Example" }],
        prickleTypes: [TAKES_HOST],
        prickles: [
          prickle("prkl_AAAAAAAAAAA1", { hostId: "mbr_AAAAAAAAAAA1" }),
          prickle("prkl_AAAAAAAAAAA2", {}),
          prickle("prkl_AAAAAAAAAAA3", { source: "zoom", zoomMeetingUuid: "meeting-1", createdAt: "2026-10-20T12:00:00Z" }),
          prickle("prkl_AAAAAAAAAAA4", { source: "zoom", zoomMeetingUuid: "meeting-2", createdAt: "2026-10-21T12:00:00Z" }),
        ],
        attendance: [{ id: "att_1", memberId: "mbr_AAAAAAAAAAA1", prickleId: "prkl_AAAAAAAAAAA4", joinTime: "2026-10-19T15:00:00Z", leaveTime: "2026-10-19T15:30:00Z" }],
      }),
    );

    await renderServerPage(DataHygienePage, {});

    expect(screen.getByText(/1\/2 assigned/)).toBeInTheDocument(); // one of two host-taking calendar prickles has a host
    expect(screen.getByText(/1 PUPs with 0 attendees detected/)).toBeInTheDocument(); // only the Pop-Up Prickle without attendance
  });

  it("offers to reprocess the whole stored calendar span when calendar items have no prickle", async () => {
    const item = (id: string, start: string, end: string) => ({
      id, google_event_id: `g-${id}`, summary: id, description: null, location: null, raw_data: {},
      start_time: start, end_time: end, creator_email: null, creator_name: null, organizer_email: null, organizer_name: null, imported_at: null,
    });
    repos = createInMemoryRepos(
      new InMemoryDataset({
        prickleTypes: [TAKES_HOST],
        prickles: [prickle("prkl_AAAAAAAAAAA1", { calendarEventId: "c1" })],
        calendarEvents: [
          item("c1", "2026-10-19T15:00:00Z", "2026-10-19T16:00:00Z"),
          item("c2", "2026-09-01T15:00:00Z", "2026-09-01T16:00:00Z"),
          item("c3", "2026-11-30T15:00:00Z", "2026-12-01T16:00:00Z"),
        ],
      }),
    );

    await renderServerPage(DataHygienePage, {});

    expect(screen.getByText(/1\/3 matched/)).toBeInTheDocument();
    expect(JSON.parse(screen.getByTestId("orphaned-range").textContent!)).toEqual({ fromDate: "2026-09-01T15:00:00Z", toDate: "2026-12-01T16:00:00Z" });
  });

  it("shows no Pop-Up Prickle warning when every one has attendance", async () => {
    repos = createInMemoryRepos(new InMemoryDataset({ prickleTypes: [TAKES_HOST], prickles: [prickle("prkl_AAAAAAAAAAA1", {})] }));

    await renderServerPage(DataHygienePage, {});

    expect(screen.queryByText(/PUPs with 0 attendees/)).not.toBeInTheDocument();
    expect(screen.getByText(/0\/1 assigned/)).toBeInTheDocument();
  });
});
