// Kinds and tiers for the member Events page (app/(member)/events). Events differ in how much they
// ask of a member: a retreat takes commitment and notice to sign up, a Pitch Prickle is a weekly or monthly
// FYI. The page highlights the special and educational ones (the tier, below; Educational is its own pillar of
// the community) above the month-at-a-glance list of everything (lib/events-agenda.ts).

export const EVENT_TYPES = [
  "in_person_retreat",
  "virtual_retreat",
  "workshop",
  "book_launch",
  "social",
  "session",
  "educational",
  "other",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** The prickle type whose events are educational (webinars and the like): its own pillar. Every other prickle's event is a session. */
const EDUCATIONAL_PRICKLE_TYPE = "educational";

/** The kind an event starts as when it is made from a prickle of this type (an admin can change it on the event). */
export function prickleEventKind(typeNormalizedName: string | null | undefined): EventType {
  return typeNormalizedName === EDUCATIONAL_PRICKLE_TYPE ? "educational" : "session";
}

/** What members see on a card or event page. */
export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  in_person_retreat: "In-Person Retreat",
  virtual_retreat: "Virtual Retreat",
  workshop: "Workshop",
  book_launch: "Book Launch",
  social: "Social",
  session: "Session",
  educational: "Educational",
  other: "Event",
};

/** The admin picker: the same kinds, with "Other" where members see a plain "Event". */
export const EVENT_TYPE_OPTIONS: { value: EventType; label: string }[] = EVENT_TYPES.map((value) => ({
  value,
  label: value === "other" ? "Other" : EVENT_TYPE_LABELS[value],
}));

export function isEventType(value: unknown): value is EventType {
  return typeof value === "string" && (EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * What an event asks of a member: **special** (a retreat, a workshop, a party, anything that takes a sign-up or
 * an application: notice, if not always commitment), **educational** (its own pillar), or **session** (a regular
 * prickle that is featured: the weekly or monthly FYI).
 */
export type EventTier = "special" | "educational" | "session";

export function eventTier(event: { event_type: string; registration?: string | null }): EventTier {
  if (event.registration && event.registration !== "none") return "special";
  if (event.event_type === "educational") return "educational";
  if (event.event_type === "session") return "session";
  return "special";
}

/** YYYY-MM-DD for `now` in `timeZone` (en-CA formats as ISO date). */
export function localDateString(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
