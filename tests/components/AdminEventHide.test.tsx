// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import EventsClient from "@/app/(admin)/admin/events/EventsClient";
import EventDetailClient from "@/app/(admin)/admin/events/[slug]/EventDetailClient";

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
  host_name: null,
  start_time: "2097-05-01T04:00:00Z",
  end_time: "2097-05-02T04:00:00Z",
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
      return { ok: true, json: async () => ({ event, prickleId: "prkl_AAAAAAAAAAA1", hubSession: false, photos: [], badgeType: null, attendees: [] }) } as Response;
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

    await userEvent.click(await screen.findByRole("button", { name: "Remove from Events" }));

    expect(await screen.findByText(/Removed from Events: members don't see it/)).toBeInTheDocument();
    expect(calls.find((c) => c.url.endsWith("/visibility"))!.body).toEqual({ hidden: true });
    expect(screen.getByRole("button", { name: "Add back to Events" })).toBeInTheDocument();
  });

  it("says the calendar sync leaves a hidden calendar event hidden, and shows it again on request", async () => {
    const hidden = { ...EVENT, deleted_at: "2097-01-01T00:00:00Z" };
    serve(hidden, { ...hidden, deleted_at: null });
    render(<EventDetailClient eventId={EVENT.id} />);
    expect(await screen.findByText(/The calendar sync leaves it removed\./)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Add back to Events" }));

    await waitFor(() => expect(screen.queryByText(/Removed from Events: members don't see/)).not.toBeInTheDocument());
    expect(calls.find((c) => c.url.endsWith("/visibility"))!.body).toEqual({ hidden: false });
  });

  it("shows why it couldn't change", async () => {
    serve(EVENT);
    render(<EventDetailClient eventId={EVENT.id} />);

    await userEvent.click(await screen.findByRole("button", { name: "Remove from Events" }));

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

    expect(await screen.findByText(/Workshop · Removed/)).toBeInTheDocument();
  });
});
