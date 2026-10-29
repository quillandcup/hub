// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import {
  MEMBER_IDENTITY,
  MEMBER_USER,
  expectRedirect,
  renderServerPage,
  resetServerPageMocks,
  signInAs,
  useFakeSupabase,
} from "@/tests/helpers/server-page";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { photoRow } from "@/tests/helpers/event-contract";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/sudo", () => import("@/tests/helpers/server-page").then((m) => m.sudoModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));

let dataset = new InMemoryDataset();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => createInMemoryRepos(dataset),
}));

const previews = vi.fn(async (_userId: string): Promise<string[]> => ["events"]);
vi.mock("@/lib/features.server", () => ({ getUserFeaturePreviews: (id: string) => previews(id) }));
vi.mock("@/app/(member)/my-prickles/calendar-feed-actions", () => ({
  getMyCalendarItems: vi.fn(async () => [{ id: "cfi_AAAAAAAAAAA1", kind: "event", eventId: "evnt_AAAAAAAAAAA1" }]),
}));
vi.mock("@/app/(member)/my-prickles/AddToCalendar", () => ({
  AddEventToCalendar: ({ eventId, itemId }: { eventId: string; itemId: string | null }) => <div data-testid="calendar">{eventId}|{itemId}</div>,
}));
vi.mock("@/app/(member)/events/[slug]/EventDetailClient", () => ({
  default: ({ event, photos, calendarControl, coverImage }: { event: { title: string }; photos: { id: string }[]; calendarControl: React.ReactNode; coverImage: { src: string; alt: string } | null }) => (
    <div>
      <div data-testid="detail">{event.title}|{photos.map((p) => p.id).join(",")}</div>
      <div data-testid="cover">{coverImage ? `${coverImage.src}|${coverImage.alt}` : "none"}</div>
      {calendarControl}
    </div>
  ),
}));

import EventDetailPage from "@/app/(member)/events/[slug]/page";

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });

beforeEach(() => {
  resetServerPageMocks();
  previews.mockResolvedValue(["events"]);
  signInAs(MEMBER_USER, MEMBER_IDENTITY);
  useFakeSupabase({});
  dataset = new InMemoryDataset({
    events: [
      { id: "evnt_AAAAAAAAAAA1", slug: "spring-retreat", title: "Spring Retreat", starts_at: "2097-04-01", ends_at: "2097-04-03" },
      { id: "evnt_AAAAAAAAAAA2", slug: "secret", title: "Secret", starts_at: "2097-04-01", ends_at: "2097-04-03", deleted_at: "2097-01-01T00:00:00Z" },
    ],
    eventPhotos: [
      photoRow({ id: "evph_AAAAAAAAAAA1", event_id: "evnt_AAAAAAAAAAA1", taken_at: "2097-04-02T10:00:00Z" }),
      photoRow({ id: "evph_AAAAAAAAAAA2", event_id: "evnt_AAAAAAAAAAA1", taken_at: "2097-04-01T10:00:00Z" }),
      photoRow({ id: "evph_AAAAAAAAAAA3", event_id: "evnt_AAAAAAAAAAA1", hidden_at: "2097-04-05T00:00:00Z" }),
    ],
  });
});

describe("member event detail page", () => {
  it("shows the event with its visible photos in the order taken, and the calendar control for an upcoming one", async () => {
    await renderServerPage(EventDetailPage, params("spring-retreat"));

    expect(screen.getByTestId("detail")).toHaveTextContent("Spring Retreat|evph_AAAAAAAAAAA2,evph_AAAAAAAAAAA1");
    expect(screen.getByTestId("calendar")).toHaveTextContent("evnt_AAAAAAAAAAA1|cfi_AAAAAAAAAAA1");
  });

  it("shows the cover image picked from the media library at the hero size, with its alt text, unless it was deleted", async () => {
    const asset = { id: "media_AAAAAAAAAAA1", alt_text: "Cedar Lodge in the fog", deleted_at: null };
    dataset.events[0] = { ...dataset.events[0], image_id: asset.id };
    dataset.mediaAssets = [asset as never];
    await renderServerPage(EventDetailPage, params("spring-retreat"));
    expect(screen.getByTestId("cover")).toHaveTextContent("/api/media/media_AAAAAAAAAAA1/event_hero|Cedar Lodge in the fog");

    cleanup();
    dataset.mediaAssets = [{ ...asset, deleted_at: "2097-01-01T00:00:00Z" } as never];
    await renderServerPage(EventDetailPage, params("spring-retreat"));
    expect(screen.getByTestId("cover")).toHaveTextContent("none");
  });

  it("is not found for a hidden event or an unknown slug", async () => {
    await expect(renderServerPage(EventDetailPage, params("secret"))).rejects.toThrow();
    await expect(renderServerPage(EventDetailPage, params("nope"))).rejects.toThrow();
  });

  it("sends a member without the events feature to the dashboard", async () => {
    previews.mockResolvedValue([]);

    await expectRedirect(EventDetailPage, params("spring-retreat"), "/dashboard");
  });
});
