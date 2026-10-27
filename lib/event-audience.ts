import { audienceChainError } from "@/lib/audience-rules";

// Who an event is for and how people join it (events.announced_publicly, guests_allowed,
// registration, capacity, selection, speakers). Shared by the admin forms, the create/update
// routes and the member event page, so they agree on the values and the wording.

export const REGISTRATION_MODES = ["none", "signup", "application"] as const;
export type RegistrationMode = (typeof REGISTRATION_MODES)[number];

export const SELECTION_MODES = ["first_come", "selected"] as const;
export type SelectionMode = (typeof SELECTION_MODES)[number];

export const REGISTRATION_LABELS: Record<RegistrationMode, string> = {
  none: "No sign-up needed",
  signup: "Sign up",
  application: "Apply",
};

export const SELECTION_LABELS: Record<SelectionMode, string> = {
  first_come: "First come, first served",
  selected: "The hosts choose",
};

/** The audience fields of an event row. */
export interface EventAudience {
  announced_publicly: boolean;
  guests_allowed: boolean;
  registration: RegistrationMode;
  capacity: number | null;
  selection: SelectionMode;
  speakers: string | null;
}

export const DEFAULT_AUDIENCE: EventAudience = {
  announced_publicly: false,
  guests_allowed: false,
  registration: "none",
  capacity: null,
  selection: "first_come",
  speakers: null,
};

export type AudienceParse = { ok: true; fields: Partial<EventAudience> } | { ok: false; error: string };

/**
 * The audience fields present in a request body, checked (`current` is what the event has now, for an update). A field the body leaves out is left
 * out of the result (so an update changes only what it names); an invalid one is an error.
 */
export function parseEventAudience(
  body: Record<string, unknown>,
  current: Pick<EventAudience, "announced_publicly" | "guests_allowed"> = DEFAULT_AUDIENCE,
): AudienceParse {
  const fields: Partial<EventAudience> = {};

  for (const key of ["announced_publicly", "guests_allowed"] as const) {
    if (body[key] === undefined) continue;
    if (typeof body[key] !== "boolean") return { ok: false, error: `${key} must be a boolean` };
    fields[key] = body[key];
  }
  if (body.registration !== undefined) {
    if (!(REGISTRATION_MODES as readonly unknown[]).includes(body.registration)) {
      return { ok: false, error: `registration must be one of: ${REGISTRATION_MODES.join(", ")}` };
    }
    fields.registration = body.registration as RegistrationMode;
  }
  if (body.selection !== undefined) {
    if (!(SELECTION_MODES as readonly unknown[]).includes(body.selection)) {
      return { ok: false, error: `selection must be one of: ${SELECTION_MODES.join(", ")}` };
    }
    fields.selection = body.selection as SelectionMode;
  }
  if (body.capacity !== undefined) {
    if (body.capacity !== null && (!Number.isInteger(body.capacity) || (body.capacity as number) <= 0)) {
      return { ok: false, error: "capacity must be a positive whole number, or empty for no limit" };
    }
    fields.capacity = body.capacity as number | null;
  }
  if (body.speakers !== undefined) {
    if (body.speakers !== null && typeof body.speakers !== "string") return { ok: false, error: "speakers must be text" };
    fields.speakers = typeof body.speakers === "string" && body.speakers.trim() ? body.speakers.trim() : null;
  }
  // Guests only at something announced publicly: checked against the flags the event will have, so an update
  // that names only one of them is judged with the other as it is now.
  const rule = audienceChainError({
    listed: true,
    publicly: fields.announced_publicly ?? current.announced_publicly,
    guests: fields.guests_allowed ?? current.guests_allowed,
  });
  if (rule) return { ok: false, error: rule };
  return { ok: true, fields };
}

/** What a member is told about joining, as short phrases: "Guests welcome", "Apply", "12 places". */
export function audienceSummary(event: {
  guests_allowed: boolean;
  registration: string;
  capacity: number | null;
  selection: string;
}): string[] {
  const parts: string[] = [];
  if (event.guests_allowed) parts.push("Guests welcome");
  if (event.registration === "signup") parts.push("Sign-up required");
  if (event.registration === "application") parts.push("Application required");
  if (event.capacity !== null) {
    parts.push(`${event.capacity} ${event.capacity === 1 ? "place" : "places"}`);
    const selection = SELECTION_LABELS[event.selection as SelectionMode];
    if (event.registration !== "none" && selection) parts.push(selection);
  }
  return parts;
}
