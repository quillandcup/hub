// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { MEMBER_USER, expectRedirect, renderServerPage, resetServerPageMocks, signInAs } from "@/tests/helpers/server-page";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { eventSeed, type EventSpec } from "@/tests/helpers/event-fixtures";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));

let dataset = new InMemoryDataset();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => createInMemoryRepos(dataset),
}));

const previews = vi.fn(async (_userId: string): Promise<string[]> => ["events"]);
vi.mock("@/lib/features.server", () => ({ getUserFeaturePreviews: (id: string) => previews(id) }));
vi.mock("@/lib/timezone", () => ({ getUserTimezonePreference: async () => "America/New_York" }));
vi.mock("@/lib/event-prickles", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/event-prickles")>()),
  fetchPastEventPrickles: vi.fn(async (_s: unknown, month: { id: string }) => [{ id: `p-${month.id}`, title: "Pitch", typeName: "Pitch Prickle", hostName: null, calendarEventId: null, startTime: "2026-03-09T18:00:00Z", endTime: "2026-03-09T19:00:00Z" }]),
}));
vi.mock("@/app/(member)/events/past/PastEventsBrowser", () => ({
  default: (props: { initialMonth: string; months: { id: string }[]; events: { title: string }[]; eventPrickleIds: string[]; initialPrickles: { id: string }[] }) => (
    <div data-testid="browser" data-first={props.months[0].id} data-last={props.months.at(-1)!.id}>
      {props.initialMonth}|{props.events.map((e) => e.title).join(",")}|{props.eventPrickleIds.join(",")}|{props.initialPrickles.map((p) => p.id).join(",")}
    </div>
  ),
}));

import PastEventsPage from "@/app/(member)/events/past/page";

const event = (id: string, title: string, starts_at: string, ends_at = starts_at, extra: Partial<EventSpec> = {}): EventSpec => ({
  id: `evnt_AAAAAAAAAAA${id}`, slug: `e${id}`, title, event_type: "other", starts_at, ends_at, ...extra,
});

beforeEach(() => {
  resetServerPageMocks();
  previews.mockResolvedValue(["events"]);
  signInAs(MEMBER_USER);
  dataset = new InMemoryDataset({
    ...eventSeed([
      event("1", "Old Retreat", "2026-03-01", "2026-03-03"),
      event("5", "Pre-2026 Gathering", "2025-12-01", "2025-12-01"),
      event("2", "Far Future", "2097-04-01"),
      event("3", "Removed", "2026-05-01", "2026-05-01", { deleted_at: "2026-06-01T00:00:00Z" }),
      event("4", "Book Fair", "2026-07-01", "2026-07-01", { speakers: "Ada Example", prickleId: "prkl_AAAAAAAAAAA7" }),
    ]),
  });
});

describe("member past events page", () => {
  it("hands the browser the events that have ended, not the upcoming or removed ones, named the way members know them, with the prickles events stand on", async () => {
    await renderServerPage(PastEventsPage, { searchParams: Promise.resolve({ month: "2026-03" }) });

    expect(screen.getByTestId("browser")).toHaveTextContent("2026-03|Book Fair with Ada Example,Old Retreat|prkl_SEEDEVENT003,prkl_AAAAAAAAAAA7,prkl_SEEDEVENT004,prkl_SEEDEVENT001,prkl_SEEDEVENT002|p-2026-03");
    expect(screen.getByRole("link", { name: "← Upcoming events" })).toHaveAttribute("href", "/events");
  });

  it("offers every month from the first event's through this one, and opens on this one without ?month=", async () => {
    await renderServerPage(PastEventsPage, { searchParams: Promise.resolve({}) });

    const browser = screen.getByTestId("browser");
    expect(browser).toHaveAttribute("data-first", "2026-03");
    expect(browser.getAttribute("data-last")).toMatch(/^\d{4}-\d{2}$/);
    expect(browser.textContent!.startsWith(browser.getAttribute("data-last")!)).toBe(true);
  });

  it("opens on this month for a month that is not offered", async () => {
    await renderServerPage(PastEventsPage, { searchParams: Promise.resolve({ month: "1999-01" }) });

    const browser = screen.getByTestId("browser");
    expect(browser.textContent!.startsWith(browser.getAttribute("data-last")!)).toBe(true);
  });

  it("sends a member without the events feature to the dashboard", async () => {
    previews.mockResolvedValue([]);

    await expectRedirect(PastEventsPage, { searchParams: Promise.resolve({}) }, "/dashboard");
  });
});
