import type { EventRow } from "@/lib/data/events";
import type { Prickle } from "@/lib/data/prickles";
import { eventWindow } from "@/lib/event-window";

/** What a test writes for an event: its schedule fields (which live on the prickle it stands on) beside the event's own. */
export type EventSpec = Omit<EventRow, "prickle_id"> & {
  title?: string;
  /** Eastern days (YYYY-MM-DD); an all-day window unless `start_time`/`end_time` are given. */
  starts_at?: string;
  ends_at?: string;
  start_time?: string;
  end_time?: string;
  location?: string | null;
  speakers?: string | null;
  description?: string | null;
  hostId?: string | null;
  /** The prickle the event stands on, when a test needs to name it. */
  prickleId?: string;
};

/** The events and the prickles they stand on, ready for `new InMemoryDataset({ events, prickles })`. */
export function eventSeed(specs: EventSpec[]): { events: EventRow[]; prickles: Prickle[] } {
  const events: EventRow[] = [];
  const prickles: Prickle[] = [];
  specs.forEach((spec, i) => {
    const { title, starts_at, ends_at, start_time, end_time, location, speakers, description, hostId, prickleId: named, ...own } = spec;
    const window = eventWindow({ startDate: starts_at ?? "2097-01-01", endDate: ends_at ?? starts_at ?? "2097-01-01" });
    if (!window.ok) throw new Error(window.error);
    const prickleId = named ?? `prkl_SEEDEVENT${String(i + 1).padStart(3, "0")}`;
    prickles.push({
      id: prickleId,
      typeId: null,
      hostId: hostId ?? null,
      title: title ?? null,
      description: description ?? null,
      location: location ?? null,
      guestSpeaker: speakers ?? null,
      startTime: start_time ?? window.startTime,
      endTime: end_time ?? window.endTime,
      source: "calendar",
      calendarEventId: null,
      zoomMeetingUuid: null,
      hubSessionId: null,
    });
    events.push({ ...own, prickle_id: prickleId });
  });
  return { events, prickles };
}
