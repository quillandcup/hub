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
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import type { EventRow } from "@/lib/data/events";
import { photoRow } from "@/tests/helpers/event-contract";

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
vi.mock("@/lib/timezone", () => ({ getUserTimezonePreference: async () => "browser" }));
vi.mock("@/lib/event-prickles", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/event-prickles")>()),
  fetchUpcomingEventPrickles: vi.fn(async () => [
    { id: "prkl_AAAAAAAAAAA1", title: "Query Letters 101", typeName: "Webinar Prickle", hostName: "Ada Example", calendarEventId: null, startTime: "2097-03-03T15:00:00Z", endTime: "2097-03-03T16:00:00Z" },
    { id: "prkl_AAAAAAAAAAA2", title: "Pitch Night", typeName: "Pitch Prickle", hostName: null, calendarEventId: "00000000-0000-4000-8000-00000000000a", startTime: "2097-03-04T15:00:00Z", endTime: "2097-03-04T16:00:00Z" },
  ]),
}));
vi.mock("@/app/(member)/events/EventsBrowser", () => ({
  default: (props: { initialMonth: string; months: { id: string }[]; eventPrickles: { title: string }[]; events: { title: string; cover_photo_id: string | null; image_id?: string | null; badge_icon?: string | null }[] }) => (
    <div data-testid="browser" data-month={props.initialMonth} data-months={props.months.map((m) => m.id).join(",")}>
      |{props.eventPrickles.map((p) => p.title).join(",")}|{props.events.map((e) => e.title).join(",")}
      <span data-testid="icons">{props.events.map((e) => e.badge_icon ?? "none").join(",")}</span>
      <span data-testid="covers">{props.events.map((e) => e.cover_photo_id ?? "none").join(",")}</span>
      <span data-testid="images">{props.events.map((e) => e.image_id ?? "none").join(",")}</span>
    </div>
  ),
}));

import EventsPage from "@/app/(member)/events/page";

const seed = (events: EventRow[], eventPhotos: InMemoryDataset["eventPhotos"] = []) => {
  dataset = new InMemoryDataset({ events, eventPhotos });
};

const RETREAT: EventRow = { id: "evnt_AAAAAAAAAAA1", slug: "retreat", title: "Spring Retreat", event_type: "in_person_retreat", starts_at: "2097-04-01", ends_at: "2097-04-03" };

beforeEach(() => {
  resetServerPageMocks();
  previews.mockResolvedValue(["events"]);
  signInAs(MEMBER_USER);
  useFakeSupabase({});
  seed([RETREAT]);
});

describe("member Events page", () => {
  it("hands the browser the events and the prickles of types listed in Events", async () => {
    await renderServerPage(EventsPage, { searchParams: Promise.resolve({}) });

    expect(screen.getByTestId("browser")).toHaveTextContent("|Query Letters 101,Pitch Night|Spring Retreat");
  });

  it("uses an event's first visible photo as its cover", async () => {
    seed([RETREAT], [
      photoRow({ id: "evph_AAAAAAAAAAA1", event_id: RETREAT.id, hidden_at: "2097-01-01T00:00:00Z", taken_at: "2097-04-01T09:00:00Z" }),
      photoRow({ id: "evph_AAAAAAAAAAA2", event_id: RETREAT.id, taken_at: "2097-04-01T10:00:00Z" }),
    ]);

    await renderServerPage(EventsPage, { searchParams: Promise.resolve({}) });

    expect(screen.getByTestId("covers")).toHaveTextContent("evph_AAAAAAAAAAA2");
  });

  it("passes along the cover image picked from the media library", async () => {
    seed([{ ...RETREAT, image_id: "media_AAAAAAAAAAA1" }]);

    await renderServerPage(EventsPage, { searchParams: Promise.resolve({}) });

    expect(screen.getByTestId("images")).toHaveTextContent("media_AAAAAAAAAAA1");
  });

  it("gives an event the icon of the badge linked to it", async () => {
    dataset = new InMemoryDataset({
      events: [RETREAT],
      badgeTypes: [{ id: "bdgt_AAAAAAAAAAA1", key: "spring_retreat", name: "Spring Retreat", description: null, icon: "💡", category: "retreat", has_levels: false, is_automatic: false, program_id: null, event_id: RETREAT.id }],
    });

    await renderServerPage(EventsPage, { searchParams: Promise.resolve({}) });

    expect(screen.getByTestId("icons")).toHaveTextContent("💡");
  });

  it("lists a prickle once: an event that follows its calendar event stands in for it", async () => {
    seed([{ id: "evnt_AAAAAAAAAAA2", slug: "pitch-night", title: "Pitch Night", event_type: "other", starts_at: "2097-03-04", ends_at: "2097-03-04", calendar_event_id: "00000000-0000-4000-8000-00000000000a" }]);

    await renderServerPage(EventsPage, { searchParams: Promise.resolve({}) });

    expect(screen.getByTestId("browser")).toHaveTextContent("|Query Letters 101|Pitch Night");
  });

  it("lists neither a hidden event nor the prickle it stands for", async () => {
    seed([
      { id: "evnt_AAAAAAAAAAA3", slug: "pitch-night", title: "Pitch Night", event_type: "other", starts_at: "2097-03-04", ends_at: "2097-03-04", calendar_event_id: "00000000-0000-4000-8000-00000000000a", deleted_at: "2097-01-01T00:00:00Z" },
      { id: "evnt_AAAAAAAAAAA4", slug: "spring-retreat", title: "Spring Retreat", event_type: "other", starts_at: "2097-04-01", ends_at: "2097-04-03" },
    ]);

    await renderServerPage(EventsPage, { searchParams: Promise.resolve({}) });

    expect(screen.getByTestId("browser")).toHaveTextContent("|Query Letters 101|Spring Retreat");
  });

  it("names an event with its speakers, the way members know it, and leaves an event with none as it is", async () => {
    seed([
      { id: "evnt_AAAAAAAAAAA5", slug: "money", title: "A Way to Make Money", event_type: "other", starts_at: "2097-04-01", ends_at: "2097-04-01", speakers: "Brayden Example" },
      { id: "evnt_AAAAAAAAAAA6", slug: "fair", title: "Book Fair", event_type: "other", starts_at: "2097-05-01", ends_at: "2097-05-01" },
      { id: "evnt_AAAAAAAAAAA7", slug: "progress", title: "Progress Prickle", event_type: "other", starts_at: "2097-05-02", ends_at: "2097-05-02", host_name: "Jenn Parker" },
    ]);

    await renderServerPage(EventsPage, { searchParams: Promise.resolve({}) });

    // A speaker names the event; otherwise its host does ("Progress Prickle" alone says nothing with thirty a week).
    expect(screen.getByTestId("browser")).toHaveTextContent("Progress Prickle with Jenn P,Book Fair,A Way to Make Money with Brayden Example");
  });

  it("offers this month and the next two, starting on this one unless ?month= names another", async () => {
    await renderServerPage(EventsPage, { searchParams: Promise.resolve({ month: "bogus" }) });
    const months = screen.getByTestId("browser").getAttribute("data-months")!.split(",");
    expect(months).toHaveLength(3);
    expect(screen.getByTestId("browser")).toHaveAttribute("data-month", months[0]);

    await renderServerPage(EventsPage, { searchParams: Promise.resolve({ month: months[2] }) });
    expect(screen.getAllByTestId("browser").at(-1)).toHaveAttribute("data-month", months[2]);
  });

  it("sends a member without the events feature to the dashboard", async () => {
    previews.mockResolvedValue([]);

    await expectRedirect(EventsPage, { searchParams: Promise.resolve({}) }, "/dashboard");
  });
});
