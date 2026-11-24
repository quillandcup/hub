// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import EventKajabiTickets from "@/app/(admin)/admin/events/[slug]/EventKajabiTickets";

const EVENT = "evt_AAAAAAAAAAA1";
const SUMMER = { kajabiOfferId: "o1", name: "Summer Retreat", detail: "#o1" };
const AUTUMN = { kajabiOfferId: "o3", name: "Autumn Retreat", detail: "PAY IN FULL for Autumn · #o3" };

const MATCHES = {
  offersLinked: true,
  multiTicketBuyers: [] as { member_id: string | null; name: string; tickets: number; first_bought: string | null; is_attendee: boolean; passed_to: string[]; unexplained: number }[],
  passedOn: [] as { giver_id: string; giver_name: string; tickets: number; receivers: string[] }[],
  notAttending: [] as { member_id: string; member_name: string; member_real_name: string | null; reason: string; note: string | null }[],
  movedAway: [] as { member_id: string; member_name: string; member_real_name: string | null; destinations: string[] }[],
  buyers: [
    { member_id: "mbr_AAAAAAAAAAA1", member_name: "Ada E", member_real_name: "Ada Example", member_status: "active", offer_names: ["Summer Retreat"], purchase_date: "2097-01-10T12:00:00Z", amount_in_cents: 5000, purchase_count: 1, deactivated: false },
    { member_id: "mbr_AAAAAAAAAAA2", member_name: "Bo Example", member_real_name: null, member_status: "cancelled", offer_names: ["Summer Retreat"], purchase_date: "2097-01-11T12:00:00Z", amount_in_cents: 5000, purchase_count: 1, deactivated: true },
  ],
  unmatched: [{ email: "stranger@example.com", offer_names: ["Summer Retreat"], purchase_date: "2097-01-12T12:00:00Z" }],
  attendeesWithoutTicket: [{ member_id: "mbr_AAAAAAAAAAA3", member_name: "Cy Example", ticket_source: null, kajabi_offer: "held" }],
};

let calls: { url: string; method: string; body: unknown }[];
let linked: (typeof SUMMER & { purchasedFrom?: string | null; purchasedUntil?: string | null })[];
let available: (typeof AUTUMN & { otherEvents?: { title: string }[] })[];
let matches: unknown;
let failNext: string | null;

beforeEach(() => {
  calls = [];
  linked = [SUMMER];
  available = [AUTUMN];
  matches = MATCHES;
  failNext = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (failNext && method !== "GET") return { ok: false, json: async () => ({ error: failNext }) } as Response;
      if (url.endsWith("/offers") && method === "GET") return { ok: true, json: async () => ({ linked, available }) } as Response;
      if (url.includes("/kajabi-matches")) return { ok: true, json: async () => matches } as Response;
      return { ok: true, json: async () => ({ success: true }) } as Response;
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Kajabi tickets on an event", () => {
  it("loads the matches on open without asking Kajabi, and checks grants only on Find Kajabi matches", async () => {
    render(<EventKajabiTickets eventId={EVENT} onAttendeesChanged={vi.fn()} />);

    expect(await screen.findByText(/Bought a ticket, not an attendee/)).toBeInTheDocument();
    const matchUrls = () => calls.filter((c) => c.url.includes("/kajabi-matches")).map((c) => c.url);
    expect(matchUrls()).toEqual([`/api/admin/events/${EVENT}/kajabi-matches`]);

    await userEvent.click(screen.getByRole("button", { name: "Find Kajabi matches" }));
    await waitFor(() => expect(matchUrls()).toEqual([`/api/admin/events/${EVENT}/kajabi-matches`, `/api/admin/events/${EVENT}/kajabi-matches?grants=1`]));
  });

  it("shows no Kajabi note for an attendee whose grants were not checked", async () => {
    matches = { ...MATCHES, attendeesWithoutTicket: [{ ...MATCHES.attendeesWithoutTicket[0], kajabi_offer: "not_checked" }] };
    render(<EventKajabiTickets eventId={EVENT} onAttendeesChanged={vi.fn()} />);

    expect(await screen.findByText("Cy Example")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't check Kajabi.")).toBeNull();
  });

  it("shows Mark not attending as a visible button beside each buyer", async () => {
    render(<EventKajabiTickets eventId={EVENT} onAttendeesChanged={vi.fn()} />);
    const buttons = await screen.findAllByRole("button", { name: /^Mark .* as not attending$/ });
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveTextContent("Mark not attending");
  });

  it("shows the linked offers and links another one", async () => {
    const onAttendeesChanged = vi.fn();
    render(<EventKajabiTickets eventId={EVENT} onAttendeesChanged={onAttendeesChanged} />);

    expect(await screen.findByText("Summer Retreat")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Kajabi offer to link"), "o3");
    await userEvent.click(screen.getByRole("button", { name: "Link offer" }));

    await waitFor(() => expect(calls.find((c) => c.method === "POST")).toEqual({ url: `/api/admin/events/${EVENT}/offers`, method: "POST", body: { kajabiOfferId: "o3" } }));
  });

  it("shows each offer's internal title, price and id so same-named offers can be told apart, and filters on them", async () => {
    render(<EventKajabiTickets eventId={EVENT} onAttendeesChanged={vi.fn()} />);
    await screen.findByText("Summer Retreat");
    expect(screen.getByText("#o1")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Autumn Retreat (PAY IN FULL for Autumn · #o3)" })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Filter Kajabi offers"), "pay in full");
    expect(screen.getByRole("option", { name: /Autumn Retreat/ })).toBeInTheDocument();
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

  it("links an offer for purchases between two days", async () => {
    render(<EventKajabiTickets eventId={EVENT} onAttendeesChanged={vi.fn()} />);
    await screen.findByText("Summer Retreat");

    await userEvent.selectOptions(screen.getByLabelText("Kajabi offer to link"), "o3");
    fireEvent.change(screen.getByLabelText("Purchases from"), { target: { value: "2026-02-01" } });
    fireEvent.change(screen.getByLabelText("Purchases until"), { target: { value: "2026-03-01" } });
    await userEvent.click(screen.getByRole("button", { name: "Link offer" }));

    await waitFor(() => expect(calls.find((c) => c.method === "POST")?.body).toEqual({ kajabiOfferId: "o3", purchasedFrom: "2026-02-01", purchasedUntil: "2026-03-01" }));
  });

  it("labels an offer that is already linked to another event in the list", async () => {
    available = [{ ...AUTUMN, otherEvents: [{ title: "Winter Retreat" }] }];
    render(<EventKajabiTickets eventId={EVENT} onAttendeesChanged={vi.fn()} />);

    expect(await screen.findByRole("option", { name: /Autumn Retreat.*also linked to Winter Retreat/ })).toBeInTheDocument();
  });

  it("shows each linked offer's window and edits or clears it", async () => {
    linked = [{ ...SUMMER, purchasedFrom: "2026-02-01", purchasedUntil: null }];
    render(<EventKajabiTickets eventId={EVENT} onAttendeesChanged={vi.fn()} />);

    expect(await screen.findByText("purchases from 2026-02-01")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Edit purchase dates for Summer Retreat" }));
    const [editFrom, editUntil] = screen.getAllByLabelText(/Purchases (from|until)/).slice(0, 2);
    expect(editFrom).toHaveValue("2026-02-01");
    fireEvent.change(editUntil, { target: { value: "2026-03-15" } });
    await userEvent.click(screen.getByRole("button", { name: "Save dates" }));

    await waitFor(() => expect(calls.find((c) => c.method === "PATCH")).toEqual({ url: `/api/admin/events/${EVENT}/offers/o1`, method: "PATCH", body: { purchasedFrom: "2026-02-01", purchasedUntil: "2026-03-15" } }));

    await userEvent.click(screen.getByRole("button", { name: "Edit purchase dates for Summer Retreat" }));
    await userEvent.click(screen.getByRole("button", { name: "Clear dates" }));
    await userEvent.click(screen.getByRole("button", { name: "Save dates" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "PATCH").at(-1)?.body).toEqual({ purchasedFrom: null, purchasedUntil: null }));
  });

  it("describes a window with only an end", async () => {
    linked = [{ ...SUMMER, purchasedFrom: null, purchasedUntil: "2026-03-15" }];
    render(<EventKajabiTickets eventId={EVENT} onAttendeesChanged={vi.fn()} />);
    expect(await screen.findByText("purchases until 2026-03-15")).toBeInTheDocument();
  });

  it("shows the message when the dates overlap another event", async () => {
    linked = [{ ...SUMMER, purchasedFrom: "2026-02-01", purchasedUntil: null }];
    render(<EventKajabiTickets eventId={EVENT} onAttendeesChanged={vi.fn()} />);
    await screen.findByText("purchases from 2026-02-01");
    failNext = "That offer is already linked to another event for purchases on overlapping days.";

    await userEvent.click(screen.getByRole("button", { name: "Edit purchase dates for Summer Retreat" }));
    await userEvent.click(screen.getByRole("button", { name: "Save dates" }));

    expect(await screen.findByText(/overlapping days/)).toBeInTheDocument();
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
    expect(screen.getAllByText("Cy Example").length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole("button", { name: "Add 1 as attendees" }));

    await waitFor(() => expect(onAttendeesChanged).toHaveBeenCalled());
    const adds = calls.filter((c) => c.method === "POST");
    expect(adds).toEqual([{ url: `/api/admin/events/${EVENT}/attendees`, method: "POST", body: { memberId: "mbr_AAAAAAAAAAA1" } }]);
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
    matches = { offersLinked: true, multiTicketBuyers: [], passedOn: [], notAttending: [], movedAway: [], buyers: [], unmatched: [], attendeesWithoutTicket: [] };
    render(<EventKajabiTickets eventId={EVENT} onAttendeesChanged={vi.fn()} />);

    await userEvent.click(await screen.findByRole("button", { name: "Find Kajabi matches" }));

    expect(await screen.findByText("Everyone who bought a ticket is already an attendee.")).toBeInTheDocument();
  });
  it("warns when a buyer and an attendee may be one person, and leaves that buyer unticked", async () => {
    matches = {
      ...MATCHES,
      buyers: [{ ...MATCHES.buyers[0], possible_duplicate: { member_id: "mbr_AAAAAAAAAAA3", member_name: "Cy Example" } }],
      attendeesWithoutTicket: [{ ...MATCHES.attendeesWithoutTicket[0], possible_duplicate: { member_id: "mbr_AAAAAAAAAAA1", member_name: "Ada E" } }],
    };
    render(<EventKajabiTickets eventId={EVENT} onAttendeesChanged={vi.fn()} />);

    await userEvent.click(await screen.findByRole("button", { name: "Find Kajabi matches" }));

    expect(await screen.findByLabelText("Add Ada E")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Add 0 as attendees" })).toBeDisabled();
    const hints = screen.getAllByText(/May be the same person as/);
    expect(hints).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Cy Example" })).toHaveAttribute("href", "/admin/members/mbr_AAAAAAAAAAA3");
    // "Ada E" is both the buyer's name and the target of the attendee's hint.
    expect(screen.getAllByRole("link", { name: "Ada E" }).map((a) => a.getAttribute("href"))).toContain("/admin/members/mbr_AAAAAAAAAAA1");
  });
  it("lists who bought more than one ticket: who the extras went to, and only the ones not accounted for as a count", async () => {
    matches = {
      ...MATCHES,
      multiTicketBuyers: [
        { member_id: "mbr_AAAAAAAAAAA1", name: "Ada E", tickets: 2, first_bought: "2097-01-10T12:00:00Z", is_attendee: true, passed_to: ["Di Example"], unexplained: 0 },
        { member_id: null, name: "stranger@example.com", tickets: 3, first_bought: null, is_attendee: false, passed_to: [], unexplained: 3 },
      ],
    };
    render(<EventKajabiTickets eventId={EVENT} onAttendeesChanged={vi.fn()} />);

    await userEvent.click(await screen.findByRole("button", { name: "Find Kajabi matches" }));

    expect(await screen.findByText("Bought more than one ticket (3 not accounted for)")).toBeInTheDocument();
    expect(screen.getByText("2 tickets · 2097-01-10 · attendee")).toBeInTheDocument();
    expect(screen.getByText("-> gave to Di Example")).toBeInTheDocument();
    expect(screen.getByText("3 not accounted for")).toBeInTheDocument();
    expect(screen.queryByText(/recorded as gifted/)).not.toBeInTheDocument();
  });

  it("shows no count when every extra ticket is explained", async () => {
    matches = {
      ...MATCHES,
      multiTicketBuyers: [{ member_id: "mbr_AAAAAAAAAAA1", name: "Ada E", tickets: 2, first_bought: null, is_attendee: true, passed_to: ["Di Example"], unexplained: 0 }],
    };
    render(<EventKajabiTickets eventId={EVENT} onAttendeesChanged={vi.fn()} />);

    await userEvent.click(await screen.findByRole("button", { name: "Find Kajabi matches" }));

    expect(await screen.findByText("Bought more than one ticket")).toBeInTheDocument();
    expect(screen.queryByText(/not accounted for/)).not.toBeInTheDocument();
  });

  it("lists a buyer who passed their ticket on in the Not attending section, read-only, with the way to remove it", async () => {
    matches = { ...MATCHES, passedOn: [{ giver_id: "mbr_AAAAAAAAAAA2", giver_name: "Bo Example", tickets: 1, receivers: ["Cy Example"] }] };
    render(<EventKajabiTickets eventId={EVENT} onAttendeesChanged={vi.fn()} />);

    await userEvent.click(await screen.findByRole("button", { name: "Find Kajabi matches" }));

    expect(await screen.findByText("Not attending (1)")).toBeInTheDocument();
    expect(screen.queryByText(/Tickets passed on/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Bo Example" }).map((a) => a.getAttribute("href"))).toContain("/admin/members/mbr_AAAAAAAAAAA2");
    expect(screen.getByText("Gave their ticket to Cy Example")).toBeInTheDocument();
    expect(screen.getByText("To remove it, change the recipient's Gifted by.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Undo/ })).not.toBeInTheDocument();
  });

  it("shows passed-on and marked buyers in one list, passed-on first, and only the marked ones can be undone", async () => {
    matches = {
      ...MATCHES,
      passedOn: [{ giver_id: "mbr_AAAAAAAAAAA2", giver_name: "Bo Example", tickets: 1, receivers: ["Cy Example"] }],
      notAttending: [{ member_id: "mbr_AAAAAAAAAAA4", member_name: "Di Example", member_real_name: null, reason: "forfeited", note: null }],
    };
    render(<EventKajabiTickets eventId={EVENT} onAttendeesChanged={vi.fn()} />);

    await userEvent.click(await screen.findByRole("button", { name: "Find Kajabi matches" }));

    expect(await screen.findByText("Not attending (2)")).toBeInTheDocument();
    const rows = screen.getByText("Not attending (2)").parentElement!.querySelectorAll("li");
    expect(rows[0]).toHaveTextContent("Gave their ticket to Cy Example");
    expect(rows[1]).toHaveTextContent("Deposit forfeited");
    expect(screen.getAllByRole("button", { name: /Undo/ })).toHaveLength(1);
  });

  it("lists a buyer whose ticket moved to another event in Not attending, between passed-on and marked ones, read-only with the hint", async () => {
    matches = {
      ...MATCHES,
      passedOn: [{ giver_id: "mbr_AAAAAAAAAAA2", giver_name: "Bo Example", tickets: 1, receivers: ["Cy Example"] }],
      movedAway: [{ member_id: "mbr_AAAAAAAAAAA1", member_name: "Ada E", member_real_name: "Ada Example", destinations: ["Autumn Retreat"] }],
      notAttending: [{ member_id: "mbr_AAAAAAAAAAA4", member_name: "Di Example", member_real_name: null, reason: "forfeited", note: null }],
    };
    render(<EventKajabiTickets eventId={EVENT} onAttendeesChanged={vi.fn()} />);

    await userEvent.click(await screen.findByRole("button", { name: "Find Kajabi matches" }));

    expect(await screen.findByText("Not attending (3)")).toBeInTheDocument();
    const rows = screen.getByText("Not attending (3)").parentElement!.querySelectorAll("li");
    expect(rows[1]).toHaveTextContent("Ticket moved to Autumn Retreat");
    expect(rows[1]).toHaveTextContent("Ada Example");
    expect(rows[1]).toHaveTextContent("To remove it, change the Transferred source on that event.");
    expect(rows[1].querySelector("a")).toHaveAttribute("href", "/admin/members/mbr_AAAAAAAAAAA1");
    expect(rows[1].querySelector("button")).toBeNull();
    expect(screen.getAllByRole("button", { name: /Undo/ })).toHaveLength(1);
  });

  it("says what Kajabi knows about each attendee with no purchase", async () => {
    matches = {
      ...MATCHES,
      attendeesWithoutTicket: [
        { member_id: "m1", member_name: "Held Example", ticket_source: null, kajabi_offer: "held" },
        { member_id: "m2", member_name: "None Example", ticket_source: null, kajabi_offer: "not_held" },
        { member_id: "m5", member_name: "Shared Example", ticket_source: null, kajabi_offer: "shared" },
        { member_id: "m3", member_name: "Unknown Example", ticket_source: null, kajabi_offer: "unknown" },
        { member_id: "m4", member_name: "NoContact Example", ticket_source: null, kajabi_offer: "no_contact" },
      ],
    };
    render(<EventKajabiTickets eventId={EVENT} onAttendeesChanged={vi.fn()} />);

    await userEvent.click(await screen.findByRole("button", { name: "Find Kajabi matches" }));

    expect(await screen.findByText(/likely granted \(comped or gifted\)/)).toBeInTheDocument();
    expect(screen.getByText("Kajabi shows no sign of this offer for them.")).toBeInTheDocument(); // one offer linked
    expect(screen.getByText(/has purchase dates or also serves another event, so it can't say which event it was for/)).toBeInTheDocument();
    expect(screen.getByText("Couldn't check Kajabi.")).toBeInTheDocument();
    expect(screen.getByText("No Kajabi contact for this member.")).toBeInTheDocument();
  });

  describe("buyers who are not attending", () => {
    const findAndWait = async () => {
      render(<EventKajabiTickets eventId={EVENT} onAttendeesChanged={vi.fn()} />);
      await userEvent.click(await screen.findByRole("button", { name: "Find Kajabi matches" }));
      await screen.findByText(/Bought a ticket, not an attendee/);
    };

    it("marks a buyer whose deposit was forfeited without asking for a note, then searches again", async () => {
      await findAndWait();

      await userEvent.click(screen.getByRole("button", { name: "Mark Ada E as not attending" }));
      expect(screen.getByLabelText("Why Ada E is not attending")).toHaveValue("forfeited");
      await userEvent.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(calls.find((c) => c.method === "POST" && c.url.endsWith("/not-attending"))?.body).toEqual({ memberId: "mbr_AAAAAAAAAAA1", reason: "forfeited", note: "" }));
      await waitFor(() => expect(calls.filter((c) => c.url.includes("/kajabi-matches")).length).toBe(3));
    });

    it("needs a note for Other", async () => {
      await findAndWait();

      await userEvent.click(screen.getByRole("button", { name: "Mark Ada E as not attending" }));
      await userEvent.selectOptions(screen.getByLabelText("Why Ada E is not attending"), "other");
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
      await userEvent.type(screen.getByLabelText("Note for Ada E"), "moved to autumn");
      await userEvent.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(calls.find((c) => c.method === "POST" && c.url.endsWith("/not-attending"))?.body).toEqual({ memberId: "mbr_AAAAAAAAAAA1", reason: "other", note: "moved to autumn" }));
    });

    it("cancels without saving, and keeps the form open with the message when the save fails", async () => {
      await findAndWait();
      await userEvent.click(screen.getByRole("button", { name: "Mark Ada E as not attending" }));
      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.queryByLabelText("Why Ada E is not attending")).not.toBeInTheDocument();

      failNext = "This member is on the attendee list. Remove them from it first.";
      await userEvent.click(screen.getByRole("button", { name: "Mark Ada E as not attending" }));
      await userEvent.click(screen.getByRole("button", { name: "Save" }));

      expect(await screen.findByText(failNext)).toBeInTheDocument();
      expect(screen.getByLabelText("Why Ada E is not attending")).toBeInTheDocument();
    });

    it("lists the marked buyers with their reason and note, and undoes a mark", async () => {
      matches = {
        ...MATCHES,
        notAttending: [
          { member_id: "mbr_AAAAAAAAAAA3", member_name: "Cy E", member_real_name: "Cy Example", reason: "forfeited", note: null },
          { member_id: "mbr_AAAAAAAAAAA4", member_name: "Di Example", member_real_name: null, reason: "other", note: "ticket moved to autumn" },
        ],
      };
      await findAndWait();

      expect(screen.getByText("Not attending (2)")).toBeInTheDocument();
      expect(screen.getByText("Deposit forfeited")).toBeInTheDocument();
      expect(screen.getByText("Other: ticket moved to autumn")).toBeInTheDocument();
      expect(screen.getAllByText("Cy Example").length).toBeGreaterThan(0);

      await userEvent.click(screen.getByRole("button", { name: "Undo not attending for Cy E" }));

      await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url === `/api/admin/events/${EVENT}/not-attending/mbr_AAAAAAAAAAA3`)).toBe(true));
      await waitFor(() => expect(calls.filter((c) => c.url.includes("/kajabi-matches")).length).toBe(3));
    });

    it("shows no section when nobody is marked", async () => {
      await findAndWait();

      expect(screen.queryByText(/^Not attending \(/)).not.toBeInTheDocument();
    });
  });
});
