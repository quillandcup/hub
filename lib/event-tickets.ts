/** How an event attendee got in (`event_attendees.ticket_source`); null means not recorded. */
export const TICKET_SOURCES = ["purchased", "comped", "gifted"] as const;
export type TicketSource = (typeof TICKET_SOURCES)[number];

export const TICKET_SOURCE_LABELS: Record<TicketSource, string> = {
  purchased: "Purchased",
  comped: "Comped",
  gifted: "Gifted",
};

export const TICKET_NOTE_MAX_LENGTH = 300;

export function isTicketSource(value: unknown): value is TicketSource {
  return typeof value === "string" && (TICKET_SOURCES as readonly string[]).includes(value);
}

/** The ticket fields a request set: a key that is absent is left as it is, null clears it. */
export interface TicketInput {
  source?: TicketSource | null;
  note?: string | null;
}

/**
 * Reads the ticket fields of a request body. `undefined` means the body doesn't mention a ticket
 * at all; an error string is for the 400. An empty source or note clears the field.
 */
export function parseTicketInput(body: { ticketSource?: unknown; ticketNote?: unknown }): TicketInput | undefined | { error: string } {
  if (body.ticketSource === undefined && body.ticketNote === undefined) return undefined;
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
  return out;
}
