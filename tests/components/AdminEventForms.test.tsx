// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

const track = vi.fn();
vi.mock("@/lib/analytics/client", () => ({ track: (...args: unknown[]) => track(...args) }));

import EventsClient from "@/app/(admin)/admin/events/EventsClient";
import EventDetailClient from "@/app/(admin)/admin/events/[slug]/EventDetailClient";

const EVENT = {
  id: "evt_AAAAAAAAAAA1",
  slug: "build-a-query",
  title: "Build-a-query",
  event_type: "workshop",
  location: null,
  starts_at: "2097-05-01",
  ends_at: "2097-05-15",
  focus: null,
  description: null,
  agenda: null,
  results: null,
  google_photos_album_url: null,
  announced_publicly: true,
  guests_allowed: true,
  registration: "application",
  capacity: 7,
  selection: "selected",
  speakers: "Ada Example",
  host_name: null,
  start_time: "2097-05-01T04:00:00Z",
  end_time: "2097-05-16T04:00:00Z",
  deleted_at: null as string | null,
};

type Call = { url: string; method: string; body: Record<string, unknown> | undefined };
let calls: Call[];

beforeEach(() => {
  track.mockClear();
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url === "/api/admin/events" && method === "GET") return { ok: true, json: async () => ({ events: [] }) } as Response;
      if (url === "/api/admin/events") return { ok: true, json: async () => ({ event: EVENT }) } as Response;
      if (url === `/api/admin/events/${EVENT.id}` && method === "GET") {
        return { ok: true, json: async () => ({ event: EVENT, prickleId: "prkl_AAAAAAAAAAA1", hubSession: true, photos: [], badgeType: null, attendees: [] }) } as Response;
      }
      if (url === `/api/admin/events/${EVENT.id}`) return { ok: true, json: async () => ({ event: { ...EVENT, capacity: 9 } }) } as Response;
      return { ok: true, json: async () => ({}) } as Response;
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("admin create event form", () => {
  it("offers the new kinds and sends who it's for and how people join", async () => {
    const { container } = render(<EventsClient />);
    await userEvent.click(await screen.findByRole("button", { name: "Add Event" }));
    const [starts, ends] = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="date"]'));

    await userEvent.type(screen.getByPlaceholderText(/Virginia Retreat/), "Craft Workshop");
    await userEvent.selectOptions(screen.getAllByRole("combobox")[0], "workshop");
    await userEvent.type(starts, "2097-06-01");
    await userEvent.type(ends, "2097-06-01");
    await userEvent.type(screen.getByLabelText("Start time"), "10:00");
    await userEvent.type(screen.getByLabelText("End time"), "11:30");
    await userEvent.type(screen.getByLabelText("Host"), "Fern Example");
    await userEvent.click(screen.getByLabelText("Announced publicly"));
    await userEvent.click(screen.getByLabelText("Guests allowed"));
    await userEvent.selectOptions(screen.getByLabelText("How people join"), "signup");
    await userEvent.type(screen.getByLabelText("Places (empty for no limit)"), "40");
    await userEvent.click(screen.getByRole("button", { name: "Create Event" }));

    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    const post = calls.find((c) => c.method === "POST")!;
    await waitFor(() => expect(track).toHaveBeenCalledWith("event_created", { from: "hub_form", ok: true }));
    expect(post.body).toMatchObject({
      title: "Craft Workshop",
      slug: "craft-workshop",
      starts_at: "2097-06-01",
      start_clock: "10:00",
      end_clock: "11:30",
      host_name: "Fern Example",
      event_type: "workshop",
      guests_allowed: true,
      announced_publicly: true,
      registration: "signup",
      capacity: 40,
      selection: "first_come",
    });
  });
});

describe("admin event detail", () => {
  it("shows who it's for and the speakers, and saves a changed limit", async () => {
    render(<EventDetailClient eventId={EVENT.id} />);

    expect(await screen.findByText("Guests welcome · Application required · 7 places · The hosts choose · Announced publicly")).toBeInTheDocument();
    expect(screen.getByText("Ada Example")).toBeInTheDocument();
    expect(screen.getByText("Workshop")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Guests allowed")).toBeChecked();
    const places = screen.getByLabelText("Places (empty for no limit)");
    await userEvent.clear(places);
    await userEvent.type(places, "9");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")!.body).toMatchObject({ capacity: 9, registration: "application", guests_allowed: true });
    expect(track).toHaveBeenCalledWith("event_edited", expect.objectContaining({ ok: true }));
    expect(await screen.findByText("Guests welcome · Application required · 9 places · The hosts choose · Announced publicly")).toBeInTheDocument();
  });

  it("says members, no sign-up, when nothing narrows it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          event: { ...EVENT, announced_publicly: false, guests_allowed: false, registration: "none", capacity: null, speakers: null },
          prickleId: "prkl_AAAAAAAAAAA1",
          hubSession: true,
          photos: [],
          badgeType: null,
          attendees: [],
        }),
      })),
    );
    render(<EventDetailClient eventId={EVENT.id} />);

    expect(await screen.findByText("Members, no sign-up")).toBeInTheDocument();
  });
});

describe("admin event on a calendar prickle", () => {
  function serve(hubSession: boolean) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ event: EVENT, prickleId: "prkl_AAAAAAAAAAA1", hubSession, photos: [], badgeType: null, attendees: [] }) }) as Response),
    );
  }

  it("keeps the dates read-only, since they come from Google Calendar, and links to the prickle", async () => {
    serve(false);
    const { container } = render(<EventDetailClient eventId={EVENT.id} />);
    expect(await screen.findByRole("link", { name: "View prickle" })).toHaveAttribute("href", "/admin/prickles/prkl_AAAAAAAAAAA1");
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Title")).toBeEnabled();

    expect(container.querySelectorAll('input[type="date"]')).toHaveLength(0);
  });

  it("edits the dates of an event made in the Hub", async () => {
    serve(true);
    const { container } = render(<EventDetailClient eventId={EVENT.id} />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));

    expect(container.querySelectorAll('input[type="date"]')).toHaveLength(2);
  });

  it("records the save of a calendar-backed event as a calendar edit", async () => {
    serve(false);
    render(<EventDetailClient eventId={EVENT.id} />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(track).toHaveBeenCalledWith("event_edited", { source: "calendar", ok: true }));
  });

  it("records the save of an event made in the Hub as a Hub edit", async () => {
    serve(true);
    render(<EventDetailClient eventId={EVENT.id} />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(track).toHaveBeenCalledWith("event_edited", { source: "hub", ok: true }));
  });
});
