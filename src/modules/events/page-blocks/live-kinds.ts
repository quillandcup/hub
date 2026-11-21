import { EVENT_TYPES, isEventType, type EventType } from "@/lib/events-filter";

/**
 * The kinds of event a live Coming up block can list and the plain word on each card's pill. Kept apart from the loader
 * because the editor (a client bundle) needs the list and the loader pulls in server code.
 * Typed `Record<EventType, ...>` so a new kind of event can't be added without its label.
 */
export const COMING_UP_KIND_LABELS: Record<EventType, string> = {
  in_person_retreat: "Retreat",
  virtual_retreat: "Virtual retreat",
  workshop: "Workshop",
  book_launch: "Book launch",
  social: "Social",
  session: "Session",
  educational: "Educational",
  other: "Event",
};

/** The editor's list of kinds to show. */
export const COMING_UP_KIND_OPTIONS = EVENT_TYPES.map((value) => ({ value, label: COMING_UP_KIND_LABELS[value] }));

/** The label for an event's kind; "Event" for one this code doesn't know. */
export const kindLabel = (eventType: string): string => (isEventType(eventType) ? COMING_UP_KIND_LABELS[eventType] : "Event");

/** What a Coming up list is headed when its heading was never set (a block saved without one; an empty heading is on purpose and stays empty). */
export const COMING_UP_LIST_HEADING = "Upcoming sessions";
