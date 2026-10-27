// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import EventsClient from "@/app/(admin)/admin/events/EventsClient";
import EventDetailClient from "@/app/(admin)/admin/events/[id]/EventDetailClient";

const EVENT = {
  id: "evt_AAAAAAAAAAA1",
  slug: "pitch-night",
  title: "Pitch Night",
  event_type: "workshop",
  location: null,
  starts_at: "2097-05-01",
  ends_at: "2097-05-01",
  focus: null,
  description: null,
  agenda: null,
  results: null,
  google_photos_album_url: null,
  announced_publicly: false,
  guests_allowed: false,
  registration: "none",
  capacity: null,
  selection: "first_come",
  speakers: null,
  calendar_event_id: null as string | null,
  overridden_fields: [] as string[],
  deleted_at: null as string | null,
};

let calls: { url: string; body: unknown }[];

function serve(event: typeof EVENT, afterChange?: typeof EVENT) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith("/visibility")) {
        return { ok: !!afterChange, json: async () => (afterChange ? { event: afterChange } : { error: "Event not found" }) } as Response;
      }
      return { ok: true, json: async () => ({ event, photos: [], badgeType: null, attendees: [] }) } as Response;
    }),
  );
}

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("hiding an event from members", () => {
  it("hides a shown event and offers to show it again", async () => {
    serve(EVENT, { ...EVENT, deleted_at: "2097-01-01T00:00:00Z" });
    render(<EventDetailClient eventId={EVENT.id} />);

    await userEvent.click(await screen.findByRole("button", { name: "Hide from members" }));

    expect(await screen.findByText(/Hidden: members don't see this event/)).toBeInTheDocument();
    expect(calls.find((c) => c.url.endsWith("/visibility"))!.body).toEqual({ hidden: true });
    expect(screen.getByRole("button", { name: "Show to members" })).toBeInTheDocument();
  });

  it("says the calendar sync leaves a hidden calendar event hidden, and shows it again on request", async () => {
    const hidden = { ...EVENT, calendar_event_id: "00000000-0000-4000-8000-00000000000a", deleted_at: "2097-01-01T00:00:00Z" };
    serve(hidden, { ...hidden, deleted_at: null });
    render(<EventDetailClient eventId={EVENT.id} />);
    expect(await screen.findByText(/The calendar sync leaves it hidden\./)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Show to members" }));

    await waitFor(() => expect(screen.queryByText(/Hidden: members don't see/)).not.toBeInTheDocument());
    expect(calls.find((c) => c.url.endsWith("/visibility"))!.body).toEqual({ hidden: false });
  });

  it("shows why it couldn't change", async () => {
    serve(EVENT);
    render(<EventDetailClient eventId={EVENT.id} />);

    await userEvent.click(await screen.findByRole("button", { name: "Hide from members" }));

    expect(await screen.findByText("Event not found")).toBeInTheDocument();
  });

  it("marks hidden events in the admin list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ events: [{ ...EVENT, deleted_at: "2097-01-01T00:00:00Z", photo_count: 0 }] }),
      })),
    );
    render(<EventsClient />);

    expect(await screen.findByText(/Workshop · Hidden/)).toBeInTheDocument();
  });
});
