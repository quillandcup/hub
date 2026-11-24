/**
 * Why a buyer of an event's ticket is not attending it. Structured where the cases are common
 * (a deposit that was not refunded) and free text where they are rare (a ticket moved to another
 * event: the note says where).
 */
export const NOT_ATTENDING_REASONS = ["forfeited", "other"] as const;
export type NotAttendingReason = (typeof NOT_ATTENDING_REASONS)[number];

export const NOT_ATTENDING_LABELS: Record<NotAttendingReason, string> = {
  forfeited: "Deposit forfeited",
  other: "Other",
};

/** A buyer marked as not attending an event. */
export interface NotAttendingMark {
  member_id: string;
  reason: NotAttendingReason;
  note: string | null;
  created_at: string;
}

/** What marking a buyer did: done, refused because the member is on the roster, or because "other" came without a note. */
export type MarkNotAttendingResult = "set" | "already_attendee" | "invalid_note";

export const MARK_NOT_ATTENDING_REFUSALS: Record<Exclude<MarkNotAttendingResult, "set">, string> = {
  already_attendee: "This member is on the attendee list. Remove them from it first.",
  invalid_note: "Say what happened: a note is needed for Other.",
};

export const NOT_ATTENDING_NOTE_MAX = 500;

export function isNotAttendingReason(value: unknown): value is NotAttendingReason {
  return typeof value === "string" && (NOT_ATTENDING_REASONS as readonly string[]).includes(value);
}

/** Reads a request body into a reason and a trimmed note (null when empty); an error message when it is not valid. */
export function parseNotAttendingInput(body: unknown): { reason: NotAttendingReason; note: string | null } | { error: string } {
  if (!body || typeof body !== "object") return { error: "Invalid JSON body" };
  const { reason, note } = body as { reason?: unknown; note?: unknown };
  if (!isNotAttendingReason(reason)) return { error: "reason must be forfeited or other" };
  if (note !== undefined && note !== null && typeof note !== "string") return { error: "note must be text" };
  const trimmed = typeof note === "string" ? note.trim() : "";
  if (trimmed.length > NOT_ATTENDING_NOTE_MAX) return { error: `note can be at most ${NOT_ATTENDING_NOTE_MAX} characters` };
  if (reason === "other" && !trimmed) return { error: MARK_NOT_ATTENDING_REFUSALS.invalid_note };
  return { reason, note: trimmed || null };
}
