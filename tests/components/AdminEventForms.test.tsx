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
  calendar_event_id: null,
  overridden_fields: [] as string[],
  deleted_at: null as string | null,
};

type Call = { url: string; method: string; body: Record<string, unknown> | undefined };
let calls: Call[];

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url === "/api/admin/events" && method === "GET") return { ok: true, json: async () => ({ events: [] }) } as Response;
      if (url === "/api/admin/events") return { ok: true, json: async () => ({ event: EVENT }) } as Response;
      if (url === `/api/admin/events/${EVENT.id}` && method === "GET") {
        return { ok: true, json: async () => ({ event: EVENT, photos: [], badgeType: null, attendees: [] }) } as Response;
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
    await userEvent.click(screen.getByLabelText("Announced publicly"));
    await userEvent.click(screen.getByLabelText("Guests allowed"));
    await userEvent.selectOptions(screen.getByLabelText("How people join"), "signup");
    await userEvent.type(screen.getByLabelText("Places (empty for no limit)"), "40");
    await userEvent.click(screen.getByRole("button", { name: "Create Event" }));

    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.body).toMatchObject({
      title: "Craft Workshop",
      slug: "craft-workshop",
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
    expect(await screen.findByText("Guests welcome · Application required · 9 places · The hosts choose · Announced publicly")).toBeInTheDocument();
  });

  it("says members, no sign-up, when nothing narrows it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          event: { ...EVENT, announced_publicly: false, guests_allowed: false, registration: "none", capacity: null, speakers: null },
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

describe("admin event that follows the calendar", () => {
  const FOLLOWING = { ...EVENT, calendar_event_id: "00000000-0000-4000-8000-00000000000a", start_time: "2097-05-02T23:00:00Z" };

  function serve(event: typeof FOLLOWING, revertTo?: typeof FOLLOWING) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        if (url.endsWith("/revert-to-calendar")) return { ok: !!revertTo, json: async () => (revertTo ? { event: revertTo } : { error: "The calendar event is gone" }) } as Response;
        return { ok: true, json: async () => ({ event, photos: [], badgeType: null, attendees: [] }) } as Response;
      }),
    );
  }

  it("says the calendar owns the dates and the text until it's changed", async () => {
    serve(FOLLOWING);
    render(<EventDetailClient eventId={EVENT.id} />);

    expect(await screen.findByText(/Follows the shared calendar: dates and times come from it; the title, description and location do too/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Follow the calendar again" })).not.toBeInTheDocument();
  });

  it("lists what was changed and follows the calendar again on request", async () => {
    serve({ ...FOLLOWING, overridden_fields: ["title", "location"] }, FOLLOWING);
    render(<EventDetailClient eventId={EVENT.id} />);
    expect(await screen.findByText(/you changed the title, location\./)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Follow the calendar again" }));

    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/revert-to-calendar") && c.method === "POST")).toBe(true));
    expect(await screen.findByText(/the title, description and location do too/)).toBeInTheDocument();
  });

  it("shows why it couldn't follow the calendar again", async () => {
    serve({ ...FOLLOWING, overridden_fields: ["title"] });
    render(<EventDetailClient eventId={EVENT.id} />);

    await userEvent.click(await screen.findByRole("button", { name: "Follow the calendar again" }));

    expect(await screen.findByText("The calendar event is gone")).toBeInTheDocument();
  });

  it("locks the dates while editing, since the calendar owns them", async () => {
    serve(FOLLOWING);
    const { container } = render(<EventDetailClient eventId={EVENT.id} />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));

    const dates = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="date"]'));
    expect(dates).toHaveLength(2);
    expect(dates.every((d) => d.disabled)).toBe(true);
  });
});
