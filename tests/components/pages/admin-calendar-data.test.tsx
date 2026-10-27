// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderServerPage, resetServerPageMocks, useFakeSupabase } from "@/tests/helpers/server-page";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
vi.mock("@/lib/admin-auth", () => ({ requireAdminPage: vi.fn(async () => undefined) }));
vi.mock("@/lib/timezone", () => ({ getUserTimezonePreference: vi.fn(async () => "UTC") }));
let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));
vi.mock("@/components/CalendarWeekView", () => ({
  default: ({ prickles }: { prickles: unknown[] }) => <pre data-testid="prickles">{JSON.stringify(prickles)}</pre>,
}));

import CalendarPage from "@/app/(admin)/admin/calendar/page";

const SPRINT = { id: "prty_AAAAAAAAAAA1", name: "Sprint", normalizedName: "sprint", purpose: "writing", requiresHost: true, soloTaskFriendly: false, listedInEvents: false, announcedPublicly: false, guestsAllowed: false };
const ADA = { id: "mbr_AAAAAAAAAAA1", name: "Ada Example" };
const prickle = (id: string, hostId: string | null, start: string, end: string, typeId: string | null = SPRINT.id) => ({
  id, typeId, hostId, title: null, startTime: start, endTime: end, source: "calendar", calendarEventId: null,
});
const join = (id: string, memberId: string, prickleId: string, joinTime: string) => ({ id, memberId, prickleId, joinTime, leaveTime: joinTime });

beforeEach(() => {
  resetServerPageMocks();
  useFakeSupabase({});
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-24T16:00:00Z")); // the week of Oct 18 is over for these prickles
});
afterEach(() => vi.useRealTimers());

describe("admin calendar page data", () => {
  it("shows the week's prickles with host, type, distinct attendees and host punctuality", async () => {
    repos = createInMemoryRepos(
      new InMemoryDataset({
        members: [ADA],
        prickleTypes: [SPRINT],
        prickles: [
          prickle("prkl_AAAAAAAAAAA1", ADA.id, "2026-10-19T15:00:00Z", "2026-10-19T16:00:00Z"), // host joined late
          prickle("prkl_AAAAAAAAAAA2", ADA.id, "2026-10-20T15:00:00Z", "2026-10-20T16:00:00Z"), // host never came
          prickle("prkl_AAAAAAAAAAA3", null, "2026-10-21T15:00:00Z", "2026-10-21T16:00:00Z", null), // no host, no type
          prickle("prkl_AAAAAAAAAAA4", ADA.id, "2026-10-26T15:00:00Z", "2026-10-26T16:00:00Z"), // next week: left out
        ],
        attendance: [
          join("att_1", ADA.id, "prkl_AAAAAAAAAAA1", "2026-10-19T15:20:00Z"),
          join("att_2", "mbr_AAAAAAAAAAA2", "prkl_AAAAAAAAAAA1", "2026-10-19T15:01:00Z"),
          join("att_3", "mbr_AAAAAAAAAAA2", "prkl_AAAAAAAAAAA1", "2026-10-19T15:40:00Z"), // rejoined: one attendee
          join("att_4", "mbr_AAAAAAAAAAA3", "prkl_AAAAAAAAAAA2", "2026-10-20T15:02:00Z"),
        ],
      }),
    );

    await renderServerPage(CalendarPage, { searchParams: Promise.resolve({ week: "2026-10-18" }) });

    const shown = JSON.parse(screen.getByTestId("prickles").textContent!);
    expect(shown.map((p: { id: string }) => p.id)).toEqual(["prkl_AAAAAAAAAAA1", "prkl_AAAAAAAAAAA2", "prkl_AAAAAAAAAAA3"]);
    expect(shown[0]).toMatchObject({ host: "Ada Example", host_id: ADA.id, prickle_type: "Sprint", attendance_count: 2, host_late: true, host_missing: false });
    expect(shown[1]).toMatchObject({ attendance_count: 1, host_late: false, host_missing: true });
    expect(shown[2]).toMatchObject({ host: "", prickle_type: "Unknown", attendance_count: 0, host_missing: false });
  });

  it("shows the host by display name, falling back to the legal name", async () => {
    const FERN = { id: "mbr_AAAAAAAAAAA2", name: "Fern Example", displayName: "Fern E" };
    repos = createInMemoryRepos(
      new InMemoryDataset({
        members: [ADA, FERN],
        prickleTypes: [SPRINT],
        prickles: [
          prickle("prkl_AAAAAAAAAAA1", FERN.id, "2026-10-19T15:00:00Z", "2026-10-19T16:00:00Z"),
          prickle("prkl_AAAAAAAAAAA2", ADA.id, "2026-10-20T15:00:00Z", "2026-10-20T16:00:00Z"),
        ],
      }),
    );

    await renderServerPage(CalendarPage, { searchParams: Promise.resolve({ week: "2026-10-18" }) });

    const shown = JSON.parse(screen.getByTestId("prickles").textContent!);
    expect(shown.map((p: { host: string }) => p.host)).toEqual(["Fern E", "Ada Example"]);
  });

  it("marks the prickles that have an event: shown in Events, or hidden from members", async () => {
    const withCalendarEvent = (id: string, calendarEventId: string | null, start: string, end: string) => ({ ...prickle(id, null, start, end), calendarEventId });
    repos = createInMemoryRepos(
      new InMemoryDataset({
        members: [ADA],
        prickleTypes: [SPRINT],
        prickles: [
          withCalendarEvent("prkl_AAAAAAAAAAA1", "00000000-0000-4000-8000-000000000001", "2026-10-19T15:00:00Z", "2026-10-19T16:00:00Z"),
          withCalendarEvent("prkl_AAAAAAAAAAA2", "00000000-0000-4000-8000-000000000002", "2026-10-20T15:00:00Z", "2026-10-20T16:00:00Z"),
          withCalendarEvent("prkl_AAAAAAAAAAA3", "00000000-0000-4000-8000-000000000003", "2026-10-21T15:00:00Z", "2026-10-21T16:00:00Z"),
          withCalendarEvent("prkl_AAAAAAAAAAA4", null, "2026-10-22T15:00:00Z", "2026-10-22T16:00:00Z"),
        ],
      }),
    );
    useFakeSupabase({
      events: {
        data: [
          { calendar_event_id: "00000000-0000-4000-8000-000000000001", deleted_at: null },
          { calendar_event_id: "00000000-0000-4000-8000-000000000002", deleted_at: "2026-10-01T00:00:00Z" },
        ],
      },
    });

    await renderServerPage(CalendarPage, { searchParams: Promise.resolve({ week: "2026-10-18" }) });

    const shown = JSON.parse(screen.getByTestId("prickles").textContent!);
    expect(shown.map((p: { in_events?: string }) => p.in_events)).toEqual(["shown", "hidden", undefined, undefined]);
  });

  it("lets an admin page on into future weeks to plan ahead", async () => {
    repos = createInMemoryRepos(new InMemoryDataset({ members: [ADA], prickleTypes: [SPRINT] }));

    // The current week and a week well ahead both link to the next one; Next is never disabled.
    for (const week of ["2026-10-18", "2027-03-07"]) {
      await renderServerPage(CalendarPage, { searchParams: Promise.resolve({ week }) });
      expect(screen.getByRole("link", { name: "Next →" })).toHaveAttribute("href", expect.stringMatching(/^\/admin\/calendar\?week=\d{4}-\d{2}-\d{2}$/));
      cleanup();
    }
  });
});
