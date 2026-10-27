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
    await renderServerPage(EventsPage, { searchParams: Promise.resolve({ type: "sessions" }) });

    expect(screen.getByTestId("browser")).toHaveTextContent("sessions|Query Letters 101,Pitch Night|Spring Retreat");
  });

  it("lists a prickle once: an event that follows its calendar event stands in for it", async () => {
    useFakeSupabase({
      events: {
        data: [
          { id: "evt_AAAAAAAAAAA2", slug: "pitch-night", title: "Pitch Night", event_type: "other", location: null, starts_at: "2097-03-04", ends_at: "2097-03-04", focus: null, calendar_event_id: "00000000-0000-4000-8000-00000000000a", event_photos: [] },
        ],
      },
    });

    await renderServerPage(EventsPage, { searchParams: Promise.resolve({ type: "sessions" }) });

    expect(screen.getByTestId("browser")).toHaveTextContent("sessions|Query Letters 101|Pitch Night");
  });

  it("lists neither a hidden event nor the prickle it stands for", async () => {
    useFakeSupabase({
      events: {
        data: [
          { id: "evt_AAAAAAAAAAA3", slug: "pitch-night", title: "Pitch Night", event_type: "other", location: null, starts_at: "2097-03-04", ends_at: "2097-03-04", focus: null, calendar_event_id: "00000000-0000-4000-8000-00000000000a", deleted_at: "2097-01-01T00:00:00Z", event_photos: [] },
          { id: "evt_AAAAAAAAAAA4", slug: "spring-retreat", title: "Spring Retreat", event_type: "other", location: null, starts_at: "2097-04-01", ends_at: "2097-04-03", focus: null, calendar_event_id: null, deleted_at: null, event_photos: [] },
        ],
      },
    });

    await renderServerPage(EventsPage, { searchParams: Promise.resolve({ type: "sessions" }) });

    expect(screen.getByTestId("browser")).toHaveTextContent("sessions|Query Letters 101|Spring Retreat");
  });

  it("names an event with its speakers, the way members know it, and leaves an event with none as it is", async () => {
    useFakeSupabase({
      events: {
        data: [
          { id: "evt_AAAAAAAAAAA5", slug: "money", title: "A Way to Make Money", event_type: "other", location: null, starts_at: "2097-04-01", ends_at: "2097-04-01", focus: null, speakers: "Brayden Example", calendar_event_id: null, deleted_at: null, event_photos: [] },
          { id: "evt_AAAAAAAAAAA6", slug: "fair", title: "Book Fair", event_type: "other", location: null, starts_at: "2097-05-01", ends_at: "2097-05-01", focus: null, speakers: null, host_name: null, calendar_event_id: null, deleted_at: null, event_photos: [] },
          { id: "evt_AAAAAAAAAAA7", slug: "progress", title: "Progress Prickle", event_type: "other", location: null, starts_at: "2097-05-02", ends_at: "2097-05-02", focus: null, speakers: null, host_name: "Jenn Parker", calendar_event_id: null, deleted_at: null, event_photos: [] },
        ],
      },
    });

    await renderServerPage(EventsPage, { searchParams: Promise.resolve({}) });

    // A speaker names the event; otherwise its host does ("Progress Prickle" alone says nothing with thirty a week).
    expect(screen.getByTestId("browser")).toHaveTextContent("A Way to Make Money with Brayden Example,Book Fair,Progress Prickle with Jenn P");
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
