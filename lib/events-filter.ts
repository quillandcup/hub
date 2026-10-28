// Kinds, tiers and filters for the member Events page (app/(member)/events). Events differ in how much they
// ask of a member: a retreat takes commitment and notice to sign up, a Pitch Prickle is a weekly or monthly
// FYI. The page groups them by that (the tier, below) instead of listing them alike, and has a filter for
// each tier plus Educational, which is its own pillar of the community.

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
 * How big a deal an event is: **big** (a retreat or workshop, or anything that takes a sign-up or an
 * application: commitment and notice), **educational** (its own pillar), **session** (a regular prickle that
 * is featured: the weekly or monthly FYI), or just an **event** (a book launch, a party...).
 */
export type EventTier = "big" | "educational" | "event" | "session";

export function eventTier(event: { event_type: string; registration?: string | null }): EventTier {
  if (event.event_type === "in_person_retreat" || event.event_type === "virtual_retreat" || event.event_type === "workshop") return "big";
  if (event.registration && event.registration !== "none") return "big";
  if (event.event_type === "educational") return "educational";
  if (event.event_type === "session") return "session";
  return "event";
}

/** Allowlist for the `?type=` param: one filter per tier. */
export const EVENT_FILTER_IDS = ["all", "big", "educational", "events", "sessions"] as const;
export type EventFilter = (typeof EVENT_FILTER_IDS)[number];

export const EVENT_FILTER_LABELS: Record<EventFilter, string> = {
  all: "All",
  big: "Big events",
  educational: "Educational",
  events: "Events",
  sessions: "Sessions",
};

const TIER_OF_FILTER: Record<Exclude<EventFilter, "all">, EventTier> = {
  big: "big",
  educational: "educational",
  events: "event",
  sessions: "session",
};

export function parseEventFilter(raw: string | string[] | undefined | null): EventFilter {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (EVENT_FILTER_IDS as readonly string[]).includes(value ?? "") ? (value as EventFilter) : "all";
}

export function tierMatchesFilter(tier: EventTier, filter: EventFilter): boolean {
  return filter === "all" || TIER_OF_FILTER[filter] === tier;
}

export interface EventLike {
  starts_at: string; // YYYY-MM-DD
  ends_at: string; // YYYY-MM-DD
  event_type: string;
  registration?: string | null;
}

/** Split into upcoming (still in progress or ahead; soonest first) and past (most recent first).
 * `today` is a YYYY-MM-DD date in the viewer's timezone. */
export function groupEvents<T extends EventLike>(
  events: readonly T[],
  filter: EventFilter,
  today: string
): { upcoming: T[]; past: T[] } {
  const matching = events.filter((e) => tierMatchesFilter(eventTier(e), filter));
  const upcoming = matching
    .filter((e) => e.ends_at >= today)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.ends_at.localeCompare(b.ends_at));
  const past = matching
    .filter((e) => e.ends_at < today)
    .sort((a, b) => b.starts_at.localeCompare(a.starts_at) || b.ends_at.localeCompare(a.ends_at));
  return { upcoming, past };
}

export type FilterCounts = Record<EventFilter, number>;

/** Upcoming-item counts per filter, for pill badges. `sessions` and `all` include the featured prickles that have no event yet. */
export function countUpcoming(events: readonly EventLike[], sessionPrickleCount: number, today: string): FilterCounts {
  const upcoming = events.filter((e) => e.ends_at >= today);
  const count = (tier: EventTier) => upcoming.filter((e) => eventTier(e) === tier).length;
  return {
    all: upcoming.length + sessionPrickleCount,
    big: count("big"),
    educational: count("educational"),
    events: count("event"),
    sessions: count("session") + sessionPrickleCount,
  };
}

/** YYYY-MM-DD for `now` in `timeZone` (en-CA formats as ISO date). */
export function localDateString(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
