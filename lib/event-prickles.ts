import type { createClient } from "@/lib/supabase/server";
import { createRepos } from "@/lib/data/repos";
import { getMemberDisplayName } from "@/lib/member-display-name";

// Upcoming prickle events for the member Events page (app/(member)/events).
// Prickle events (webinars, Hedgies on First, Monthly Goal Review, pitches...) are ordinary
// prickles whose type has `prickle_types.listed_in_events` set (an admin edits it on the prickle type),
// so this is a filtered view over `prickles` rather than a separate table.

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/** How far ahead to look for prickle events. They're scheduled a month or two out
 * on the shared calendar; this keeps the list to what's actually been announced. */
export const EVENT_PRICKLE_WINDOW_DAYS = 90;
/** Well under Supabase's 1000-row cap -- prickle events are a few per month. */
export const EVENT_PRICKLE_LIMIT = 200;

export interface EventPrickle {
  id: string;
  title: string | null;
  typeName: string;
  hostName: string | null;
  /** The calendar event it was made from; an event that follows the same one replaces it in the list. */
  calendarEventId: string | null;
  startTime: string;
  endTime: string;
}

/**
 * Prickle events that haven't ended yet (`end_time >= now`, so one in progress still
 * shows) and start within the next EVENT_PRICKLE_WINDOW_DAYS, soonest first, capped at
 * EVENT_PRICKLE_LIMIT.
 */
export async function fetchUpcomingEventPrickles(
  supabase: SupabaseClient,
  now: Date,
): Promise<EventPrickle[]> {
  const windowEnd = new Date(now.getTime() + EVENT_PRICKLE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const prickles = await createRepos(supabase).prickles.listedInEventsActiveBetween({
    from: now.toISOString(),
    to: windowEnd.toISOString(),
    limit: EVENT_PRICKLE_LIMIT,
  });

  return prickles.map((p) => ({
    id: p.id,
    title: p.title ?? null,
    typeName: p.type?.name ?? "Prickle",
    hostName: p.host ? getMemberDisplayName({ name: p.host.name, display_name: p.host.displayName }) : null,
    calendarEventId: p.calendarEventId ?? null,
    startTime: p.startTime,
    endTime: p.endTime,
  }));
}

/**
 * The prickles not already shown as an event: an event that follows a prickle's calendar event stands
 * in for it, so it isn't listed twice.
 */
export function withoutFollowedEvents(prickles: EventPrickle[], followedCalendarEventIds: Iterable<string>): EventPrickle[] {
  const followed = new Set(followedCalendarEventIds);
  return prickles.filter((p) => !p.calendarEventId || !followed.has(p.calendarEventId));
}
