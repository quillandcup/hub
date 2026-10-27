// Filtering/grouping for the member Events page (app/(member)/events). One page with a
// pill filter rather than separate Retreats / Prickle pages: retreats and other
// events share the `events` table (distinguished by `event_type`), and prickles of a type
// with `prickle_types.listed_in_events` are ordinary prickles -- so a single page can show
// "what's happening" across both, and the filter is just a view over data it already loads.

export const EVENT_TYPES = [
  "in_person_retreat",
  "virtual_retreat",
  "workshop",
  "book_launch",
  "social",
  "other",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** What members see on a card or event page. */
export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  in_person_retreat: "In-Person Retreat",
  virtual_retreat: "Virtual Retreat",
  workshop: "Workshop",
  book_launch: "Book Launch",
  social: "Social",
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

/** Allowlist for the `?type=` param. `in_person_retreat` / `virtual_retreat` are
 * sub-filters of `retreats` -- the primary pill stays on Retreats when they're active. */
export const EVENT_FILTER_IDS = [
  "all",
  "retreats",
  "in_person_retreat",
  "virtual_retreat",
  "prickles",
  "other",
] as const;
export type EventFilter = (typeof EVENT_FILTER_IDS)[number];

export type PrimaryEventFilter = "all" | "retreats" | "prickles" | "other";
export type RetreatFilter = "retreats" | "in_person_retreat" | "virtual_retreat";

export function parseEventFilter(raw: string | string[] | undefined | null): EventFilter {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (EVENT_FILTER_IDS as readonly string[]).includes(value ?? "") ? (value as EventFilter) : "all";
}

export function primaryFilterOf(filter: EventFilter): PrimaryEventFilter {
  return filter === "in_person_retreat" || filter === "virtual_retreat" ? "retreats" : filter;
}

export function isRetreatType(eventType: string): boolean {
  return eventType === "in_person_retreat" || eventType === "virtual_retreat";
}

export function eventMatchesFilter(eventType: string, filter: EventFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "retreats":
      return isRetreatType(eventType);
    case "in_person_retreat":
    case "virtual_retreat":
      return eventType === filter;
    case "other":
      return !isRetreatType(eventType);
    case "prickles":
      return false; // prickle events aren't rows in `events`
  }
}

/** Whether the event-prickles list belongs in this view. */
export function showsEventPrickles(filter: EventFilter): boolean {
  return filter === "all" || filter === "prickles";
}

export interface EventLike {
  starts_at: string; // YYYY-MM-DD
  ends_at: string; // YYYY-MM-DD
  event_type: string;
}

/** Split into upcoming (still in progress or ahead; soonest first) and past (most recent first).
 * `today` is a YYYY-MM-DD date in the viewer's timezone. */
export function groupEvents<T extends EventLike>(
  events: readonly T[],
  filter: EventFilter,
  today: string
): { upcoming: T[]; past: T[] } {
  const matching = events.filter((e) => eventMatchesFilter(e.event_type, filter));
  const upcoming = matching
    .filter((e) => e.ends_at >= today)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.ends_at.localeCompare(b.ends_at));
  const past = matching
    .filter((e) => e.ends_at < today)
    .sort((a, b) => b.starts_at.localeCompare(a.starts_at) || b.ends_at.localeCompare(a.ends_at));
  return { upcoming, past };
}

export interface FilterCounts {
  all: number;
  retreats: number;
  in_person_retreat: number;
  virtual_retreat: number;
  prickles: number;
  other: number;
}

/** Upcoming-item counts per filter, for pill badges. `all` counts events plus prickle events. */
export function countUpcoming(events: readonly EventLike[], eventPrickleCount: number, today: string): FilterCounts {
  const upcoming = events.filter((e) => e.ends_at >= today);
  const count = (f: EventFilter) => upcoming.filter((e) => eventMatchesFilter(e.event_type, f)).length;
  return {
    all: upcoming.length + eventPrickleCount,
    retreats: count("retreats"),
    in_person_retreat: count("in_person_retreat"),
    virtual_retreat: count("virtual_retreat"),
    prickles: eventPrickleCount,
    other: count("other"),
  };
}

/** YYYY-MM-DD for `now` in `timeZone` (en-CA formats as ISO date). */
export function localDateString(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
