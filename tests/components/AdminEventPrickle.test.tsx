// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import EventDetailClient from "@/app/(admin)/admin/events/[id]/EventDetailClient";

const EVENT = {
  id: "evt_AAAAAAAAAAA1",
  slug: "free-writing-hour",
  title: "Free Writing Hour",
  event_type: "other",
  location: "Zoom",
  starts_at: "2097-05-01",
  ends_at: "2097-05-01",
  focus: null,
  description: "From the prickle",
  agenda: null,
  results: null,
  google_photos_album_url: null,
  announced_publicly: true,
  guests_allowed: true,
  registration: "none",
  capacity: null,
  selection: "first_come",
  speakers: "Ada Example",
  host_name: "Jenny",
  calendar_event_id: "00000000-0000-4000-8000-00000000000a",
  overridden_fields: [] as string[],
  deleted_at: null as string | null,
};

function serve(prickleId: string | null) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ event: EVENT, prickleId, photos: [], badgeType: null, attendees: [] }) }) as Response),
  );
}

beforeEach(() => {
  serve("prkl_AAAAAAAAAAA1");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("admin event that stands for a prickle", () => {
  it("says in one notice where its title, description, guest speaker and host come from, and what follows the calendar", async () => {
    render(<EventDetailClient eventId={EVENT.id} />);

    const notice = (await screen.findByText(/Stands for a prickle: its title, description, guest speaker and host come from it/)).closest("div")!;
    expect(notice).toHaveTextContent(/Follows the shared calendar: dates and times come from it; the location does too until you change it/);
    expect(within(notice).getByRole("link", { name: "edit them on the prickle" })).toHaveAttribute("href", "/admin/prickles/prkl_AAAAAAAAAAA1");
    expect(screen.getAllByText(/Follows the shared calendar/)).toHaveLength(1); // not a second notice
  });

  it("locks the title, description and guest speaker while editing, and leaves the rest editable", async () => {
    render(<EventDetailClient eventId={EVENT.id} />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));

    expect(screen.getByDisplayValue("Free Writing Hour")).toBeDisabled();
    expect(screen.getByDisplayValue("From the prickle")).toBeDisabled();
    expect(screen.getByLabelText("Guest speakers")).toBeDisabled();
    expect(screen.getByLabelText("Guests allowed")).toBeEnabled();
    expect(screen.getByDisplayValue("Zoom")).toBeEnabled();
  });

  it("is an ordinary event, with everything editable and no note, when it has no prickle", async () => {
    serve(null);
    render(<EventDetailClient eventId={EVENT.id} />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));

    expect(screen.queryByText(/This event stands for a prickle/)).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Free Writing Hour")).toBeEnabled();
    expect(screen.getByLabelText("Guest speakers")).toBeEnabled();
    expect(screen.getByText(/the title, description and location do too until you change them/)).toBeInTheDocument();
  });
});

describe("saving from the admin event page", () => {
  function servePatch(patch: { ok: boolean; body: unknown }) {
    const calls: { method: string; body?: Record<string, unknown> }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        calls.push({ method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        if (method === "PATCH") return { ok: patch.ok, json: async () => patch.body } as Response;
        return { ok: true, json: async () => ({ event: EVENT, prickleId: "prkl_AAAAAAAAAAA1", photos: [], badgeType: null, attendees: [] }) } as Response;
      }),
    );
    return calls;
  }

  it("sends the form, shows what the server kept, and closes", async () => {
    const calls = servePatch({ ok: true, body: { event: { ...EVENT, location: "Room 9" } } });
    render(<EventDetailClient eventId={EVENT.id} />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    await userEvent.clear(screen.getByLabelText("Location"));
    await userEvent.type(screen.getByLabelText("Location"), "Room 9");

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Room 9")).toBeInTheDocument();
    expect(calls.find((c) => c.method === "PATCH")!.body).toMatchObject({ location: "Room 9" });
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("stays open and says why when the server refuses", async () => {
    servePatch({ ok: false, body: { error: "event_type must be one of: workshop" } });
    render(<EventDetailClient eventId={EVENT.id} />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("event_type must be one of: workshop")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("says so when the server gives no reason", async () => {
    servePatch({ ok: false, body: {} });
    render(<EventDetailClient eventId={EVENT.id} />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Failed to save event")).toBeInTheDocument();
  });
});

