import type { createClient } from "@/lib/supabase/server";
import { createRepos } from "@/lib/data/repos";

// Upcoming specialty prickles for the member Events page (app/(member)/events).
// Specialty prickles (webinars, Hedgies on First, Monthly Goal Review, pitches...) are ordinary
// prickles whose type has `prickle_types.is_specialty` set (an admin edits it on the prickle type),
// so this is a filtered view over `prickles` rather than a separate table.

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/** How far ahead to look for specialty prickles. They're scheduled a month or two out
 * on the shared calendar; this keeps the list to what's actually been announced. */
export const SPECIALTY_WINDOW_DAYS = 90;
/** Well under Supabase's 1000-row cap -- specialty prickles are a few per month. */
export const SPECIALTY_LIMIT = 200;

export interface SpecialtyPrickle {
  id: string;
  title: string | null;
  typeName: string;
  hostName: string | null;
  startTime: string;
  endTime: string;
}

/**
 * Specialty prickles that haven't ended yet (`end_time >= now`, so one in progress still
 * shows) and start within the next SPECIALTY_WINDOW_DAYS, soonest first, capped at
 * SPECIALTY_LIMIT.
 */
export async function fetchUpcomingSpecialtyPrickles(
  supabase: SupabaseClient,
  now: Date,
): Promise<SpecialtyPrickle[]> {
  const windowEnd = new Date(now.getTime() + SPECIALTY_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const prickles = await createRepos(supabase).prickles.specialtyActiveBetween({
    from: now.toISOString(),
    to: windowEnd.toISOString(),
    limit: SPECIALTY_LIMIT,
  });

  return prickles.map((p) => ({
    id: p.id,
    title: p.title ?? null,
    typeName: p.type?.name ?? "Specialty Prickle",
    hostName: p.host?.name ?? null,
    startTime: p.startTime,
    endTime: p.endTime,
  }));
}
