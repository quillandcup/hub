import { describe, expect, it } from "vitest";
import { TICKET_NOTE_MAX_LENGTH, isTicketSource, parseTicketInput } from "@/lib/event-tickets";

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

  it("knows the sources", () => {
    expect(isTicketSource("donated")).toBe(true);
    expect(isTicketSource("free")).toBe(false);
    expect(isTicketSource(undefined)).toBe(false);
  });
});
