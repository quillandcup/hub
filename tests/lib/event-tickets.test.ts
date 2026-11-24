import { describe, expect, it } from "vitest";
import { TICKET_NOTE_MAX_LENGTH, isTicketSource, originRefusal, parseTicketInput, recordedTicketSource } from "@/lib/event-tickets";

describe("parseTicketInput", () => {
  it("is undefined when the body does not mention a ticket", () => {
    expect(parseTicketInput({})).toBeUndefined();
  });

  it("reads a source and a trimmed note", () => {
    expect(parseTicketInput({ ticketSource: "comped", ticketNote: "  covered by staff  " })).toEqual({ source: "comped", note: "covered by staff" });
  });

  it("changes only what was sent", () => {
    expect(parseTicketInput({ ticketSource: "gifted" })).toEqual({ source: "gifted" });
    expect(parseTicketInput({ ticketNote: "from a friend" })).toEqual({ note: "from a friend" });
  });

  it("clears a field with an empty value or null", () => {
    expect(parseTicketInput({ ticketSource: "", ticketNote: "   " })).toEqual({ source: null, note: null });
    expect(parseTicketInput({ ticketSource: null, ticketNote: null })).toEqual({ source: null, note: null });
  });

  it("rejects an unknown source, a non-text note and a note that is too long", () => {
    expect(parseTicketInput({ ticketSource: "free" })).toEqual({ error: expect.stringContaining("ticketSource must be one of") });
    expect(parseTicketInput({ ticketNote: 5 })).toEqual({ error: "ticketNote must be text" });
    expect(parseTicketInput({ ticketNote: "x".repeat(TICKET_NOTE_MAX_LENGTH + 1) })).toEqual({ error: expect.stringContaining("at most") });
  });

  it("reads a giver, clears it with null or empty, and rejects anything that is not a member id", () => {
    expect(parseTicketInput({ ticketGiverId: "mbr_AAAAAAAAAAA1" })).toEqual({ giverId: "mbr_AAAAAAAAAAA1" });
    expect(parseTicketInput({ ticketGiverId: null })).toEqual({ giverId: null });
    expect(parseTicketInput({ ticketGiverId: "" })).toEqual({ giverId: null });
    expect(parseTicketInput({ ticketGiverId: "prkl_AAAAAAAAAAA1" })).toEqual({ error: "ticketGiverId must be a member id" });
    expect(parseTicketInput({ ticketGiverId: 5 })).toEqual({ error: "ticketGiverId must be a member id" });
  });

  it("reads an origin event, clears it with null or empty, and rejects anything that is not an event id", () => {
    expect(parseTicketInput({ ticketFromEventId: "evt_AAAAAAAAAAA1" })).toEqual({ fromEventId: "evt_AAAAAAAAAAA1" });
    expect(parseTicketInput({ ticketFromEventId: null })).toEqual({ fromEventId: null });
    expect(parseTicketInput({ ticketFromEventId: "" })).toEqual({ fromEventId: null });
    expect(parseTicketInput({ ticketFromEventId: "mbr_AAAAAAAAAAA1" })).toEqual({ error: "ticketFromEventId must be an event id" });
    expect(parseTicketInput({ ticketFromEventId: 5 })).toEqual({ error: "ticketFromEventId must be an event id" });
  });

  it("holds an origin to the transferred source", () => {
    const e = "evt_AAAAAAAAAAA1";
    const from = "evt_AAAAAAAAAAA2";
    expect(originRefusal(e, { fromEventId: from }, null, null)).toBe("not_transferred");
    expect(originRefusal(e, { source: "transferred", fromEventId: e }, "transferred", null)).toBe("same_event");
    expect(originRefusal(e, { source: "transferred" }, "transferred", null)).toBe("origin_required");
    expect(originRefusal(e, { fromEventId: null }, "transferred", from)).toBe("origin_required");
    // Fine: an origin given, an origin already there, a note edit on an orphaned row, or no transfer at all.
    expect(originRefusal(e, { source: "transferred", fromEventId: from }, "transferred", null)).toBeNull();
    expect(originRefusal(e, { source: "transferred" }, "transferred", from)).toBeNull();
    expect(originRefusal(e, { note: "x" }, "transferred", null)).toBeNull();
    expect(originRefusal(e, { source: "comped" }, "comped", null)).toBeNull();
  });

  it("knows the sources", () => {
    expect(isTicketSource("transferred")).toBe(true);
    expect(isTicketSource("gifted")).toBe(true);
    expect(isTicketSource("donated")).toBe(false);
    expect(isTicketSource("free")).toBe(false);
    expect(isTicketSource(undefined)).toBe(false);
  });

  it("does not record a purchase: that is derived from Kajabi", () => {
    expect(isTicketSource("purchased")).toBe(false);
    expect(parseTicketInput({ ticketSource: "purchased" })).toEqual({ error: expect.stringContaining("ticketSource must be one of") });
  });

  it("honors a stored comped or gifted source and treats anything else, such as an older stored purchased, as nothing recorded", () => {
    expect(recordedTicketSource("comped")).toBe("comped");
    expect(recordedTicketSource("gifted")).toBe("gifted");
    expect(recordedTicketSource("purchased")).toBeNull();
    expect(recordedTicketSource("donated")).toBeNull();
    expect(recordedTicketSource(null)).toBeNull();
  });
});
