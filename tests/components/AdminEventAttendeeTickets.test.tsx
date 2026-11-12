// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("@/components/MemberSearch", () => ({
  default: ({
    onSelect,
    placeholder,
    selectedMemberName,
  }: {
    onSelect: (m: { id: string; name: string; email: string } | null) => void;
    placeholder?: string;
    selectedMemberName?: string | null;
  }) =>
    placeholder === "Gifted by..." ? (
      <span>
        <span>{`giver: ${selectedMemberName ?? "none"}`}</span>
        <button type="button" onClick={() => onSelect({ id: "mbr_AAAAAAAAAAA3", name: "Cy Example", email: "cy@example.com" })}>
          pick giver
        </button>
        <button type="button" onClick={() => onSelect(null)}>
          clear giver
        </button>
      </span>
    ) : (
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
    await userEvent.selectOptions(await screen.findByLabelText("How Ada Example got in"), "");
    await waitFor(() => expect(writes).toHaveLength(1));
  });

  it("choosing Gifted on a row saves nothing until a giver is picked, then saves both together", async () => {
    render(<EventDetailClient eventId={EVENT.id} />);

    await userEvent.selectOptions(await screen.findByLabelText("How Ada Example got in"), "gifted");

    expect(writes).toEqual([]);
    expect(screen.getByText("Who gave this ticket? Pick them to save it as gifted.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "pick giver" }));

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toEqual({
      url: `/api/admin/events/${EVENT.id}/attendees/${ADA.memberId}`,
      method: "PATCH",
      body: { ticketSource: "gifted", ticketGiverId: "mbr_AAAAAAAAAAA3" },
    });
  });

  it("cancels a pending Gifted choice without saving, by choosing another source or pressing Escape", async () => {
    render(<EventDetailClient eventId={EVENT.id} />);
    const select = await screen.findByLabelText("How Ada Example got in");

    await userEvent.selectOptions(select, "gifted");
    await userEvent.selectOptions(select, "comped");
    expect(writes).toEqual([]);
    expect(screen.queryByText(/Who gave this ticket\?/)).toBeNull();

    await userEvent.selectOptions(select, "gifted");
    await userEvent.keyboard("{Escape}");
    expect(writes).toEqual([]);
    expect(screen.queryByText(/Who gave this ticket\?/)).toBeNull();
    expect(select).toHaveValue("comped");
  });

  it("prompts for the giver on a gifted row that has none, and saves just the giver", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method) writes.push({ url, method: init.method, body: JSON.parse(String(init.body)) });
        if (url === "/api/members") return { ok: true, json: async () => ({ members: [] }) } as Response;
        return {
          ok: true,
          json: async () => ({ event: EVENT, prickleId: "prkl_AAAAAAAAAAA1", hubSession: false, photos: [], badgeType: null, attendees: [{ ...ADA, ticketSource: "gifted" }] }),
        } as Response;
      }),
    );
    render(<EventDetailClient eventId={EVENT.id} />);

    // Only a giver who was deleted or merged away leaves a gifted ticket with none: the prompt says so.
    expect(await screen.findByText(/No giver on record: the member who gave this ticket may have been deleted or merged/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "pick giver" }));

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body).toEqual({ ticketGiverId: "mbr_AAAAAAAAAAA3" });
  });

  it("does not offer to clear the giver of a gifted ticket", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method) writes.push({ url, method: init.method, body: JSON.parse(String(init.body)) });
        if (url === "/api/members") return { ok: true, json: async () => ({ members: [] }) } as Response;
        return {
          ok: true,
          json: async () => ({ event: EVENT, prickleId: "prkl_AAAAAAAAAAA1", hubSession: false, photos: [], badgeType: null, attendees: [{ ...ADA, ticketSource: "gifted", ticketGiver: { id: "mbr_AAAAAAAAAAA3", name: "Cy Example" } }] }),
        } as Response;
      }),
    );
    render(<EventDetailClient eventId={EVENT.id} />);

    await userEvent.click(await screen.findByRole("button", { name: "clear giver" }));

    expect(screen.queryByText(/Who gave this ticket\?/)).toBeNull();
    expect(screen.getByText(/A gifted ticket needs a giver\. To remove it, change the source above/)).toBeInTheDocument();
    expect(writes).toEqual([]);

    // Picking a giver again takes the hint away.
    await userEvent.click(screen.getByRole("button", { name: "pick giver" }));
    await waitFor(() => expect(screen.queryByText(/A gifted ticket needs a giver/)).toBeNull());
  });

  it("keeps Add attendee disabled for a gifted ticket until a giver is picked", async () => {
    render(<EventDetailClient eventId={EVENT.id} />);

    await userEvent.click(await screen.findByRole("button", { name: "pick member" }));
    await userEvent.selectOptions(screen.getByLabelText("How they got in"), "gifted");

    expect(screen.getByRole("button", { name: "Add attendee" })).toBeDisabled();
    expect(screen.getByText("Pick who gave the ticket")).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "pick giver" })[0]);
    expect(screen.getByRole("button", { name: "Add attendee" })).toBeEnabled();
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
    await userEvent.click(screen.getAllByRole("button", { name: "pick giver" })[0]);
    await userEvent.type(screen.getByLabelText("Ticket note"), "from a friend");
    await userEvent.click(screen.getByRole("button", { name: "Add attendee" }));

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toEqual({
      url: `/api/admin/events/${EVENT.id}/attendees`,
      method: "POST",
      body: { memberId: "mbr_AAAAAAAAAAA2", ticketSource: "gifted", ticketNote: "from a friend", ticketGiverId: "mbr_AAAAAAAAAAA3" },
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

    await userEvent.selectOptions(select, "");

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
  it("shows an attendee who bought in Kajabi as Purchased, with no Not recorded choice, until a source is recorded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/members") return { ok: true, json: async () => ({ members: [] }) } as Response;
        const bought = { ...ADA, ticketSource: null, ticketNote: null, purchasedInKajabi: true };
        const comped = { ...ADA, id: "a2", memberId: "mbr_AAAAAAAAAAA2", memberName: "Bo Example", purchasedInKajabi: false };
        const unknown = { ...ADA, id: "a3", memberId: "mbr_AAAAAAAAAAA3", memberName: "Cy Example", ticketSource: null, ticketNote: null, purchasedInKajabi: false };
        return {
          ok: true,
          json: async () => ({ event: EVENT, prickleId: "prkl_AAAAAAAAAAA1", hubSession: false, photos: [], badgeType: null, attendees: [bought, comped, unknown] }),
        } as Response;
      }),
    );
    render(<EventDetailClient eventId={EVENT.id} />);

    const adaSelect = await screen.findByLabelText("How Ada Example got in");
    expect(adaSelect).toHaveValue("purchased");
    expect(within(adaSelect).queryByRole("option", { name: "Not recorded" })).not.toBeInTheDocument();
    expect(within(adaSelect).getByRole("option", { name: "Purchased" })).toBeInTheDocument();
    // No note field for a source nobody recorded.
    expect(screen.queryByLabelText("Ticket note for Ada Example")).not.toBeInTheDocument();
    // Someone with no purchase keeps Not recorded, and a recorded source is shown as recorded.
    expect(screen.getByLabelText("How Cy Example got in")).toHaveValue("");
    expect(screen.getByLabelText("How Bo Example got in")).toHaveValue("comped");
  });
  it("clears a source recorded by hand when Purchased is picked for someone who bought", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method) writes.push({ url, method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined });
        if (url === "/api/members") return { ok: true, json: async () => ({ members: [] }) } as Response;
        return {
          ok: true,
          json: async () => ({ event: EVENT, prickleId: "prkl_AAAAAAAAAAA1", hubSession: false, photos: [], badgeType: null, attendees: [{ ...ADA, purchasedInKajabi: true }] }),
        } as Response;
      }),
    );
    render(<EventDetailClient eventId={EVENT.id} />);

    await userEvent.selectOptions(await screen.findByLabelText("How Ada Example got in"), "purchased");

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body).toEqual({ ticketSource: null, ticketNote: null });
  });

  describe("gifted by", () => {
    const serve = (attendee: object) =>
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init?: RequestInit) => {
          if (init?.method) writes.push({ url, method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined });
          if (url === "/api/members") return { ok: true, json: async () => ({ members: [] }) } as Response;
          return {
            ok: true,
            json: async () => ({ event: EVENT, prickleId: "prkl_AAAAAAAAAAA1", hubSession: false, photos: [], badgeType: null, attendees: [attendee] }),
          } as Response;
        }),
      );

    it("shows the giver picker only for a gifted attendee, with the chosen giver's name", async () => {
      serve({ ...ADA, ticketSource: "gifted", ticketGiver: { id: "mbr_AAAAAAAAAAA3", name: "Cy E" } });
      render(<EventDetailClient eventId={EVENT.id} />);

      expect(await screen.findByText("giver: Cy E")).toBeInTheDocument();
    });

    it("has no giver picker for a comped attendee", async () => {
      render(<EventDetailClient eventId={EVENT.id} />);

      await screen.findByLabelText("How Ada Example got in");
      expect(screen.queryByRole("button", { name: "pick giver" })).not.toBeInTheDocument();
    });

    it("saves a chosen giver and never clears it", async () => {
      serve({ ...ADA, ticketSource: "gifted", ticketGiver: { id: "mbr_AAAAAAAAAAA3", name: "Cy E" } });
      render(<EventDetailClient eventId={EVENT.id} />);

      await userEvent.click(await screen.findByRole("button", { name: "pick giver" }));
      await waitFor(() => expect(writes).toHaveLength(1));
      expect(writes[0]).toEqual({ url: `/api/admin/events/${EVENT.id}/attendees/${ADA.memberId}`, method: "PATCH", body: { ticketGiverId: "mbr_AAAAAAAAAAA3" } });

      await userEvent.click(screen.getByRole("button", { name: "clear giver" }));
      expect(writes).toHaveLength(1);
    });

    it("hides the giver picker again once the source changes away from gifted", async () => {
      serve({ ...ADA, ticketSource: "gifted", ticketGiver: { id: "mbr_AAAAAAAAAAA3", name: "Cy E" } });
      render(<EventDetailClient eventId={EVENT.id} />);
      await screen.findByText("giver: Cy E");
      // The server clears the giver with the source; the refreshed list no longer has it.
      serve({ ...ADA, ticketSource: "comped", ticketGiver: null });

      await userEvent.selectOptions(screen.getByLabelText("How Ada Example got in"), "comped");

      await waitFor(() => expect(screen.queryByText(/^giver:/)).not.toBeInTheDocument());
      expect(writes.at(-1)?.body).toEqual({ ticketSource: "comped" });
    });

    it("offers the giver picker on the add form only when Gifted is chosen, and sends the giver", async () => {
      render(<EventDetailClient eventId={EVENT.id} />);
      await userEvent.click(await screen.findByRole("button", { name: "pick member" }));
      expect(screen.queryByRole("button", { name: "pick giver" })).not.toBeInTheDocument();

      await userEvent.selectOptions(screen.getByLabelText("How they got in"), "gifted");
      await userEvent.click(screen.getByRole("button", { name: "pick giver" }));
      await userEvent.click(screen.getByRole("button", { name: "Add attendee" }));

      await waitFor(() => expect(writes).toHaveLength(1));
      expect(writes[0].body).toEqual({ memberId: "mbr_AAAAAAAAAAA2", ticketSource: "gifted", ticketGiverId: "mbr_AAAAAAAAAAA3" });
    });
  });
});
