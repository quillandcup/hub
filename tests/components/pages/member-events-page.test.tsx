// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import {
  MEMBER_USER,
  expectRedirect,
  renderServerPage,
  resetServerPageMocks,
  signInAs,
  useFakeSupabase,
} from "@/tests/helpers/server-page";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));

const previews = vi.fn(async (_userId: string): Promise<string[]> => ["events"]);
vi.mock("@/lib/features.server", () => ({ getUserFeaturePreviews: (id: string) => previews(id) }));
vi.mock("@/lib/timezone", () => ({ getUserTimezonePreference: async () => "browser" }));
vi.mock("@/lib/event-prickles", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/event-prickles")>()),
  fetchUpcomingEventPrickles: vi.fn(async () => [
    { id: "prkl_AAAAAAAAAAA1", title: "Query Letters 101", typeName: "Webinar Prickle", hostName: "Ada Example", calendarEventId: null, startTime: "2097-03-03T15:00:00Z", endTime: "2097-03-03T16:00:00Z" },
    { id: "prkl_AAAAAAAAAAA2", title: "Pitch Night", typeName: "Pitch Prickle", hostName: null, calendarEventId: "00000000-0000-4000-8000-00000000000a", startTime: "2097-03-04T15:00:00Z", endTime: "2097-03-04T16:00:00Z" },
  ]),
}));
vi.mock("@/app/(member)/events/EventsBrowser", () => ({
  default: (props: { initialFilter: string; eventPrickles: { title: string }[]; events: { title: string }[] }) => (
    <div data-testid="browser">
      {props.initialFilter}|{props.eventPrickles.map((p) => p.title).join(",")}|{props.events.map((e) => e.title).join(",")}
    </div>
  ),
}));

import EventsPage from "@/app/(member)/events/page";

beforeEach(() => {
  resetServerPageMocks();
  previews.mockResolvedValue(["events"]);
  signInAs(MEMBER_USER);
  useFakeSupabase({ events: { data: [{ id: "evt_AAAAAAAAAAA1", slug: "retreat", title: "Spring Retreat", event_type: "in_person_retreat", location: null, starts_at: "2097-04-01", ends_at: "2097-04-03", focus: null, event_photos: [] }] } });
});

describe("member Events page", () => {
  it("hands the browser the events and the prickles of types listed in Events", async () => {
    await renderServerPage(EventsPage, { searchParams: Promise.resolve({ type: "prickles" }) });

    expect(screen.getByTestId("browser")).toHaveTextContent("prickles|Query Letters 101,Pitch Night|Spring Retreat");
  });

  it("lists a prickle once: an event that follows its calendar event stands in for it", async () => {
    useFakeSupabase({
      events: {
        data: [
          { id: "evt_AAAAAAAAAAA2", slug: "pitch-night", title: "Pitch Night", event_type: "other", location: null, starts_at: "2097-03-04", ends_at: "2097-03-04", focus: null, calendar_event_id: "00000000-0000-4000-8000-00000000000a", event_photos: [] },
        ],
      },
    });

    await renderServerPage(EventsPage, { searchParams: Promise.resolve({ type: "prickles" }) });

    expect(screen.getByTestId("browser")).toHaveTextContent("prickles|Query Letters 101|Pitch Night");
  });

  it("starts on All for an unknown filter", async () => {
    await renderServerPage(EventsPage, { searchParams: Promise.resolve({ type: "bogus" }) });

    expect(screen.getByTestId("browser")).toHaveTextContent(/^all\|/);
  });

  it("sends a member without the events feature to the dashboard", async () => {
    previews.mockResolvedValue([]);

    await expectRedirect(EventsPage, { searchParams: Promise.resolve({}) }, "/dashboard");
  });
});
