import type { calendar_v3 } from "googleapis";
import { asJson } from "@/lib/data/json";
import type { NewCalendarSourceEvent } from "@/lib/data/calendar-events";

/** An event with a start and end time (not an all-day item), which is all the Hub stores. */
export function isTimedEvent(event: calendar_v3.Schema$Event): boolean {
  return Boolean(event.id && event.start?.dateTime && event.end?.dateTime);
}

/** A Google Calendar event as the Bronze row the import writes (`bronze.calendar_events`). */
export function toBronzeEvent(event: calendar_v3.Schema$Event): NewCalendarSourceEvent {
  return {
    google_event_id: event.id as string,
    summary: event.summary || null,
    description: event.description || null,
    location: event.location || null,
    start_time: event.start!.dateTime as string,
    end_time: event.end!.dateTime as string,
    creator_email: event.creator?.email || null,
    creator_name: event.creator?.displayName || null,
    organizer_email: event.organizer?.email || null,
    organizer_name: event.organizer?.displayName || null,
    raw_data: asJson(event),
  };
}
