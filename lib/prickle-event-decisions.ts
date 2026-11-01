import type { Db } from "@/lib/data/db";
import { createRepos } from "@/lib/data/repos";

/**
 * What an admin can decide for a calendar prickle. A text field set to null follows the calendar again
 * (the sync takes the calendar's text), a field left out is not changed.
 */
export type EventDecisionChoice = Partial<{
  resolved_type_id: string;
  resolved_host_id: string;
  resolved_title: string | null;
  resolved_description: string | null;
  resolved_guest_speaker: string | null;
  resolved_location: string | null;
}>;

/**
 * Stores an admin's choice for a calendar prickle as its event's decision (`unmatched_calendar_events`),
 * because that is what `/api/process/calendar` applies on every reprocess; changing only the prickle
 * would be undone by the next run. An event matched automatically has no such row yet, so one is added.
 * Returns an `{ error }` to hand back to the caller, or null when it saved.
 */
export async function saveEventDecision(
  supabase: Db,
  calendarEventId: string,
  choice: EventDecisionChoice
): Promise<{ error: string } | null> {
  const decision = { status: "resolved", resolved_at: new Date().toISOString(), ...choice };
  const repos = createRepos(supabase);
  try {
    if (await repos.unmatchedEvents.existsForCalendarEvent(calendarEventId)) {
      await repos.unmatchedEvents.updateForCalendarEvent(calendarEventId, decision);
      return null;
    }
  } catch {
    return { error: "Couldn't save the change" };
  }
  const event = await repos.calendarEvents.byId(calendarEventId).catch(() => null);
  if (!event?.summary) return { error: "The calendar event is gone, so the change wouldn't last" };
  try {
    await repos.unmatchedEvents.insert({ calendar_event_id: calendarEventId, raw_summary: event.summary, ...decision });
    return null;
  } catch {
    return { error: "Couldn't save the change" };
  }
}

/** What an admin has set by hand for a calendar event, or nothing: null where the prickle follows the calendar. */
export interface EventDecisionValues {
  resolved_type_id: string | null;
  resolved_host_id: string | null;
  resolved_title: string | null;
  resolved_description: string | null;
  resolved_guest_speaker: string | null;
  resolved_location: string | null;
}

export async function loadEventDecision(supabase: Db, calendarEventId: string): Promise<EventDecisionValues> {
  // A failed read shows nothing set by hand, as before.
  const data = await createRepos(supabase).unmatchedEvents.valuesFor(calendarEventId).catch(() => null);
  return {
    resolved_type_id: data?.resolved_type_id ?? null,
    resolved_host_id: data?.resolved_host_id ?? null,
    resolved_title: data?.resolved_title ?? null,
    resolved_description: data?.resolved_description ?? null,
    resolved_guest_speaker: data?.resolved_guest_speaker ?? null,
    resolved_location: data?.resolved_location ?? null,
  };
}
