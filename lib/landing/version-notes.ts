/** The longest a version's note may be (the table's check says the same). */
export const VERSION_NOTE_MAX = 200;

/** A note as stored: trimmed, cut to the limit, and null when there is nothing. */
export const cleanNote = (note: string | null | undefined): string | null => note?.trim().slice(0, VERSION_NOTE_MAX) || null;

/** What a version's "by" reads when the admin has no member record (never a user id). */
export const UNKNOWN_EDITOR = "Someone";
