// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import EventKajabiTickets from "@/app/(admin)/admin/events/[slug]/EventKajabiTickets";

const EVENT = "evt_AAAAAAAAAAA1";
const SUMMER = { kajabiOfferId: "o1", name: "Summer Retreat" };
const AUTUMN = { kajabiOfferId: "o3", name: "Autumn Retreat" };

const MATCHES = {
  offersLinked: true,
  buyers: [
    { member_id: "mbr_AAAAAAAAAAA1", member_name: "Ada E", member_real_name: "Ada Example", member_status: "active", offer_names: ["Summer Retreat"], purchase_date: "2097-01-10T12:00:00Z", amount_in_cents: 5000, purchase_count: 1, deactivated: false },
    { member_id: "mbr_AAAAAAAAAAA2", member_name: "Bo Example", member_real_name: null, member_status: "cancelled", offer_names: ["Summer Retreat"], purchase_date: "2097-01-11T12:00:00Z", amount_in_cents: 5000, purchase_count: 1, deactivated: true },
  ],
  unmatched: [{ email: "stranger@example.com", offer_names: ["Summer Retreat"], purchase_date: "2097-01-12T12:00:00Z" }],
  attendeesWithoutTicket: [{ member_id: "mbr_AAAAAAAAAAA3", member_name: "Cy Example", ticket_source: null }],
};

let calls: { url: string; method: string; body: unknown }[];
let linked: typeof SUMMER[];
let matches: typeof MATCHES;
let failNext: string | null;

beforeEach(() => {
  calls = [];
  linked = [SUMMER];
  matches = MATCHES;
  failNext = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (failNext && method !== "GET") return { ok: false, json: async () => ({ error: failNext }) } as Response;
      if (url.endsWith("/offers") && method === "GET") return { ok: true, json: async () => ({ linked, available: [AUTUMN] }) } as Response;
      if (url.endsWith("/kajabi-matches")) return { ok: true, json: async () => matches } as Response;
      return { ok: true, json: async () => ({ success: true }) } as Response;
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Kajabi tickets on an event", () => {
  it("shows the linked offers and links another one", async () => {
    const onAttendeesChanged = vi.fn();
    render(<EventKajabiTickets eventId={EVENT} onAttendeesChanged={onAttendeesChanged} />);

    expect(await screen.findByText("Summer Retreat")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Kajabi offer to link"), "o3");
    await userEvent.click(screen.getByRole("button", { name: "Link offer" }));

    await waitFor(() => expect(calls.find((c) => c.method === "POST")).toEqual({ url: `/api/admin/events/${EVENT}/offers`, method: "POST", body: { kajabiOfferId: "o3" } }));
  });

  it("filters the offers to choose from", async () => {
    render(<EventKajabiTickets eventId={EVENT} onAttendeesChanged={vi.fn()} />);
    await screen.findByText("Summer Retreat");

    await userEvent.type(screen.getByLabelText("Filter Kajabi offers"), "winter");

    expect(screen.queryByRole("option", { name: "Autumn Retreat" })).not.toBeInTheDocument();
  });

  it("unlinks an offer", async () => {
    render(<EventKajabiTickets eventId={EVENT} onAttendeesChanged={vi.fn()} />);

    await userEvent.click(await screen.findByRole("button", { name: "Unlink" }));

    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url === `/api/admin/events/${EVENT}/offers/o1`)).toBe(true));
  });

  it("shows the error when linking is refused", async () => {
    render(<EventKajabiTickets eventId={EVENT} onAttendeesChanged={vi.fn()} />);
    await screen.findByText("Summer Retreat");
    failNext = "That offer already sells another event";

    await userEvent.selectOptions(screen.getByLabelText("Kajabi offer to link"), "o3");
    await userEvent.click(screen.getByRole("button", { name: "Link offer" }));

    expect(await screen.findByText("That offer already sells another event")).toBeInTheDocument();
  });

  it("offers no search until an offer is linked", async () => {
    linked = [];
    render(<EventKajabiTickets eventId={EVENT} onAttendeesChanged={vi.fn()} />);
    await screen.findByLabelText("Kajabi offer to link");

    expect(screen.queryByRole("button", { name: "Find Kajabi matches" })).not.toBeInTheDocument();
  });

  it("lists the matches, starts a deactivated purchase unchecked, and adds the checked buyers as purchased", async () => {
    const onAttendeesChanged = vi.fn();
    render(<EventKajabiTickets eventId={EVENT} onAttendeesChanged={onAttendeesChanged} />);

    await userEvent.click(await screen.findByRole("button", { name: "Find Kajabi matches" }));

    expect(await screen.findByLabelText("Add Ada E")).toBeChecked();
    expect(screen.getByLabelText("Add Bo Example")).not.toBeChecked();
    expect(screen.getByText(/purchase deactivated or refunded/)).toBeInTheDocument();
    expect(screen.getByText("stranger@example.com")).toBeInTheDocument();
    expect(screen.getByText("Cy Example")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Add 1 as attendees" }));

    await waitFor(() => expect(onAttendeesChanged).toHaveBeenCalled());
    const adds = calls.filter((c) => c.method === "POST");
    expect(adds).toEqual([{ url: `/api/admin/events/${EVENT}/attendees`, method: "POST", body: { memberId: "mbr_AAAAAAAAAAA1", ticketSource: "purchased" } }]);
  });

  it("can add a deactivated purchase once it is ticked, and counts failures", async () => {
    render(<EventKajabiTickets eventId={EVENT} onAttendeesChanged={vi.fn()} />);
    await userEvent.click(await screen.findByRole("button", { name: "Find Kajabi matches" }));
    await userEvent.click(await screen.findByLabelText("Add Bo Example"));
    failNext = "boom";

    await userEvent.click(screen.getByRole("button", { name: "Add 2 as attendees" }));

    expect(await screen.findByText("2 of 2 could not be added")).toBeInTheDocument();
  });

  it("says when everyone who bought is already an attendee", async () => {
    matches = { offersLinked: true, buyers: [], unmatched: [], attendeesWithoutTicket: [] };
    render(<EventKajabiTickets eventId={EVENT} onAttendeesChanged={vi.fn()} />);

    await userEvent.click(await screen.findByRole("button", { name: "Find Kajabi matches" }));

    expect(await screen.findByText("Everyone who bought a ticket is already an attendee.")).toBeInTheDocument();
  });
});
