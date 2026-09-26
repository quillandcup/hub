// Filtering/grouping for the member Events page (app/(member)/events). One page with a
// pill filter rather than separate Retreats / Educational pages: retreats and other
// events share the `events` table (distinguished by `event_type`), and educational
// prickles are ordinary prickles whose type is `prickle_types.normalized_name =
// 'educational'` -- so a single page can show "what's happening" across both, and
// the filter is just a view over data it already loads.

export const EVENT_TYPES = ["in_person_retreat", "virtual_retreat", "other"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  in_person_retreat: "In-Person Retreat",
  virtual_retreat: "Virtual Retreat",
  other: "Event",
};

/** Allowlist for the `?type=` param. `in_person_retreat` / `virtual_retreat` are
 * sub-filters of `retreats` -- the primary pill stays on Retreats when they're active. */
export const EVENT_FILTER_IDS = [
  "all",
  "retreats",
  "in_person_retreat",
  "virtual_retreat",
  "educational",
  "other",
] as const;
export type EventFilter = (typeof EVENT_FILTER_IDS)[number];

export type PrimaryEventFilter = "all" | "retreats" | "educational" | "other";
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
    case "educational":
      return false; // educational prickles aren't rows in `events`
  }
}

/** Whether the educational-prickles list belongs in this view. */
export function showsEducationalPrickles(filter: EventFilter): boolean {
  return filter === "all" || filter === "educational";
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
  educational: number;
  other: number;
}

/** Upcoming-item counts per filter, for pill badges. `all` counts events plus educational prickles. */
export function countUpcoming(events: readonly EventLike[], educationalCount: number, today: string): FilterCounts {
  const upcoming = events.filter((e) => e.ends_at >= today);
  const count = (f: EventFilter) => upcoming.filter((e) => eventMatchesFilter(e.event_type, f)).length;
  return {
    all: upcoming.length + educationalCount,
    retreats: count("retreats"),
    in_person_retreat: count("in_person_retreat"),
    virtual_retreat: count("virtual_retreat"),
    educational: educationalCount,
    other: count("other"),
  };
}

/** YYYY-MM-DD for `now` in `timeZone` (en-CA formats as ISO date). */
export function localDateString(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
