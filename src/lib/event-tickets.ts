import { isId } from "@/lib/ids";

/**
 * How an event attendee got in when it was not a purchase (`event_attendees.ticket_source`); null means
 * nothing was recorded. "Purchased" is not here on purpose: it is derived from Kajabi's purchases of the
 * event's linked offers (`purchasersOfEvent`), so it follows a cancellation instead of going stale.
 */
export const TICKET_SOURCES = ["comped", "gifted"] as const;
export type TicketSource = (typeof TICKET_SOURCES)[number];

export const TICKET_SOURCE_LABELS: Record<TicketSource, string> = {
  comped: "Comped",
  gifted: "Gifted",
};

export const TICKET_NOTE_MAX_LENGTH = 300;

/** What the database holds as a source we still honor: older rows may hold "purchased" (now derived), which counts as nothing recorded. */
export function recordedTicketSource(raw: string | null | undefined): TicketSource | null {
  return isTicketSource(raw) ? raw : null;
}

export function isTicketSource(value: unknown): value is TicketSource {
  return typeof value === "string" && (TICKET_SOURCES as readonly string[]).includes(value);
}

/** What `setAttendeeTicket` did: "set", or why it refused (nothing was changed). */
export type SetTicketResult = "set" | "not_attendee" | "self_gift" | "not_gifted" | "unknown_giver" | "giver_required";

/** The ticket fields a request set: a key that is absent is left as it is, null clears it. */
export interface TicketInput {
  source?: TicketSource | null;
  note?: string | null;
  /** The member who gave the ticket (member id); only with the source gifted. Null clears it. */
  giverId?: string | null;
}

/**
 * Reads the ticket fields of a request body. `undefined` means the body doesn't mention a ticket
 * at all; an error string is for the 400. An empty source or note clears the field.
 */
export function parseTicketInput(body: { ticketSource?: unknown; ticketNote?: unknown; ticketGiverId?: unknown }): TicketInput | undefined | { error: string } {
  if (body.ticketSource === undefined && body.ticketNote === undefined && body.ticketGiverId === undefined) return undefined;
  const out: TicketInput = {};
  if (body.ticketSource !== undefined) {
    if (body.ticketSource !== null && body.ticketSource !== "" && !isTicketSource(body.ticketSource)) {
      return { error: `ticketSource must be one of: ${TICKET_SOURCES.join(", ")}` };
    }
    out.source = isTicketSource(body.ticketSource) ? body.ticketSource : null;
  }
  if (body.ticketNote !== undefined) {
    if (body.ticketNote !== null && typeof body.ticketNote !== "string") return { error: "ticketNote must be text" };
    const note = (body.ticketNote ?? "").trim();
    if (note.length > TICKET_NOTE_MAX_LENGTH) return { error: `ticketNote must be at most ${TICKET_NOTE_MAX_LENGTH} characters` };
    out.note = note || null;
  }
  if (body.ticketGiverId !== undefined) {
    if (body.ticketGiverId === null || body.ticketGiverId === "") out.giverId = null;
    else if (typeof body.ticketGiverId === "string" && isId(body.ticketGiverId, "mbr")) out.giverId = body.ticketGiverId;
    else return { error: "ticketGiverId must be a member id" };
  }
  return out;
}

/** The message for a refused `setAttendeeTicket`, for the 400. */
export const SET_TICKET_REFUSALS: Record<Exclude<SetTicketResult, "set" | "not_attendee">, string> = {
  self_gift: "A member can't be their own ticket giver",
  not_gifted: "A giver can only be set when the ticket is gifted",
  unknown_giver: "The giver is not a member",
  giver_required: "Pick who gave the ticket",
};

