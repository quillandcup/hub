// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("@/components/MemberSearch", () => ({
  default: ({ onSelect }: { onSelect: (m: { id: string; name: string; email: string }) => void }) => (
    <button type="button" onClick={() => onSelect({ id: "mbr_AAAAAAAAAAA2", name: "Bo Example", email: "bo@example.com" })}>
      pick member
    </button>
  ),
}));

import EventDetailClient from "@/app/(admin)/admin/events/[slug]/EventDetailClient";

const EVENT = {
  id: "evt_AAAAAAAAAAA1",
  slug: "summer-retreat",
  title: "Summer Retreat",
  event_type: "virtual_retreat",
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
  deleted_at: null,
};

const ADA = {
  id: "a1",
  memberId: "mbr_AAAAAAAAAAA1",
  memberName: "Ada Example",
  memberEmail: "ada@example.com",
  ticketSource: "comped",
  ticketNote: "covered by staff",
};

let writes: { url: string; method: string; body: unknown }[];

beforeEach(() => {
  writes = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method) writes.push({ url, method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined });
      if (url === "/api/members") return { ok: true, json: async () => ({ members: [] }) } as Response;
      return {
        ok: true,
        json: async () => ({ event: EVENT, prickleId: "prkl_AAAAAAAAAAA1", hubSession: false, photos: [], badgeType: null, attendees: [ADA] }),
      } as Response;
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("how an attendee got in", () => {
  it("shows each attendee's ticket source and note", async () => {
    render(<EventDetailClient eventId={EVENT.id} />);

    expect(await screen.findByLabelText("How Ada Example got in")).toHaveValue("comped");
    expect(screen.getByLabelText("Ticket note for Ada Example")).toHaveValue("covered by staff");
  });

  it("changes the source of an attendee without touching the note", async () => {
    render(<EventDetailClient eventId={EVENT.id} />);

    await userEvent.selectOptions(await screen.findByLabelText("How Ada Example got in"), "gifted");

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toEqual({ url: `/api/admin/events/${EVENT.id}/attendees/${ADA.memberId}`, method: "PATCH", body: { ticketSource: "gifted" } });
  });

  it("clears the source and the note when set back to not recorded", async () => {
    render(<EventDetailClient eventId={EVENT.id} />);

    await userEvent.selectOptions(await screen.findByLabelText("How Ada Example got in"), "");

    // The note says how they got in, so it goes with the source.
    await waitFor(() => expect(writes[0]?.body).toEqual({ ticketSource: null, ticketNote: null }));
  });

  it("saves an edited note when the field loses focus, and clears it when emptied", async () => {
    render(<EventDetailClient eventId={EVENT.id} />);
    const note = await screen.findByLabelText("Ticket note for Ada Example");

    await userEvent.clear(note);
    await userEvent.type(note, "gifted by Joanne");
    await userEvent.tab();

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toEqual({ url: `/api/admin/events/${EVENT.id}/attendees/${ADA.memberId}`, method: "PATCH", body: { ticketNote: "gifted by Joanne" } });

    await userEvent.clear(note);
    await userEvent.tab();

    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1].body).toEqual({ ticketNote: "" });
  });

  it("does not save a note that did not change", async () => {
    render(<EventDetailClient eventId={EVENT.id} />);
    const note = await screen.findByLabelText("Ticket note for Ada Example");

    await userEvent.click(note);
    await userEvent.tab();

    expect(writes).toEqual([]);
  });

  it("sends the ticket with a new attendee", async () => {
    render(<EventDetailClient eventId={EVENT.id} />);

    await userEvent.click(await screen.findByRole("button", { name: "pick member" }));
    await userEvent.selectOptions(screen.getByLabelText("How they got in"), "gifted");
    await userEvent.type(screen.getByLabelText("Ticket note"), "from a friend");
    await userEvent.click(screen.getByRole("button", { name: "Add attendee" }));

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toEqual({
      url: `/api/admin/events/${EVENT.id}/attendees`,
      method: "POST",
      body: { memberId: "mbr_AAAAAAAAAAA2", ticketSource: "gifted", ticketNote: "from a friend" },
    });
  });

  it("adds an attendee with no ticket fields when none were chosen", async () => {
    render(<EventDetailClient eventId={EVENT.id} />);

    await userEvent.click(await screen.findByRole("button", { name: "pick member" }));
    await userEvent.click(screen.getByRole("button", { name: "Add attendee" }));

    await waitFor(() => expect(writes[0]?.body).toEqual({ memberId: "mbr_AAAAAAAAAAA2" }));
  });

  it("shows the error when updating the ticket fails", async () => {
    render(<EventDetailClient eventId={EVENT.id} />);
    const select = await screen.findByLabelText("How Ada Example got in");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ error: "Not an attendee of this event" }) }) as Response));

    await userEvent.selectOptions(select, "comped");

    expect(await screen.findByText("Not an attendee of this event")).toBeInTheDocument();
  });
  it("keeps the page on screen while it refreshes after a save, instead of flashing Loading", async () => {
    let refresh: (() => void) | undefined;
    let eventLoads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/members") return { ok: true, json: async () => ({ members: [] }) } as Response;
        if (init?.method === "PATCH") return { ok: true, json: async () => ({ success: true }) } as Response;
        const body = { event: EVENT, prickleId: "prkl_AAAAAAAAAAA1", hubSession: false, photos: [], badgeType: null, attendees: [ADA] };
        // The first load answers at once; the refresh after the save answers only when the test says so.
        if (++eventLoads > 1) await new Promise<void>((resolve) => (refresh = resolve));
        return { ok: true, json: async () => body } as Response;
      }),
    );
    render(<EventDetailClient eventId={EVENT.id} />);
    const note = await screen.findByLabelText("Ticket note for Ada Example");

    await userEvent.clear(note);
    await userEvent.type(note, "gifted by Joanne");
    await userEvent.tab();
    await waitFor(() => expect(refresh).toBeDefined());

    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    expect(screen.getByLabelText("How Ada Example got in")).toBeInTheDocument();
    refresh!();
  });
});
