import type { createClient } from "@/lib/supabase/server";
import { createRepos } from "@/lib/data/repos";
import type { PrickleDetail } from "@/lib/data/prickles";
import { getMemberDisplayName } from "@/lib/member-display-name";
import { dateIn, withoutFollowedEvents, type AgendaMonth } from "@/lib/events-agenda";

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
 * EVENT_PRICKLE_LIMIT. `windowDays` widens the look-ahead for a page that shows further out.
 */
export async function fetchUpcomingEventPrickles(
  supabase: SupabaseClient,
  now: Date,
  windowDays: number = EVENT_PRICKLE_WINDOW_DAYS,
): Promise<EventPrickle[]> {
  const windowEnd = new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000);

  const prickles = await createRepos(supabase).prickles.listedInEventsActiveBetween({
    from: now.toISOString(),
    to: windowEnd.toISOString(),
    limit: EVENT_PRICKLE_LIMIT,
  });

  return prickles.map(toEventPrickle);
}

function toEventPrickle(p: PrickleDetail): EventPrickle {
  return {
    id: p.id,
    title: p.title ?? null,
    typeName: p.type?.name ?? "Prickle",
    hostName: p.host ? getMemberDisplayName({ name: p.host.name, display_name: p.host.displayName }) : null,
    calendarEventId: p.calendarEventId ?? null,
    startTime: p.startTime,
    endTime: p.endTime,
  };
}

/**
 * The prickles of listed types that started in a month (as the viewer reads the dates) and have already ended,
 * soonest first: the past side of the Events page, consistent with the upcoming side. Looked up a month at a time.
 */
export async function fetchPastEventPrickles(
  supabase: SupabaseClient,
  month: AgendaMonth,
  timeZone: string,
  now: Date,
): Promise<EventPrickle[]> {
  // A day either side covers every zone's midnight; the dates are then read in the viewer's zone.
  const DAY = 24 * 60 * 60 * 1000;
  const from = new Date(Date.parse(`${month.first}T00:00:00Z`) - DAY);
  const to = new Date(Date.parse(`${month.last}T00:00:00Z`) + 2 * DAY);
  const prickles = await createRepos(supabase).prickles.listedInEventsActiveBetween({
    from: from.toISOString(),
    to: to.toISOString(),
    limit: EVENT_PRICKLE_LIMIT,
  });
  return prickles
    .filter((p) => Date.parse(p.endTime) < now.getTime())
    .map(toEventPrickle)
    .filter((p) => {
      const day = dateIn(p.startTime, timeZone);
      return day >= month.first && day <= month.last;
    });
}

/**
 * The prickles not already shown as an event: an event that follows a prickle's calendar event stands
 * in for it, so it isn't listed twice.
 */
export { withoutFollowedEvents };
