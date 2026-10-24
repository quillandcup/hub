import type { createClient } from "@/lib/supabase/server";
import { createRepos } from "@/lib/data/repos";

// Upcoming educational prickles for the member Events page (app/(member)/events).
// Educational prickles are ordinary prickles whose type has
// `prickle_types.normalized_name = 'educational'` (seeded by migration
// 20260424000002), so this is a filtered view over `prickles` rather than a
// separate table.

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/** How far ahead to look for educational prickles. They're scheduled a month or two out
 * on the shared calendar; this keeps the list to what's actually been announced. */
export const EDUCATIONAL_WINDOW_DAYS = 90;
/** Well under Supabase's 1000-row cap -- educational prickles are a few per month. */
export const EDUCATIONAL_LIMIT = 200;

export interface EducationalPrickle {
  id: string;
  title: string | null;
  typeName: string;
  hostName: string | null;
  startTime: string;
  endTime: string;
}

/**
 * Educational prickles that haven't ended yet (`end_time >= now`, so one in progress still
 * shows) and start within the next EDUCATIONAL_WINDOW_DAYS, soonest first, capped at
 * EDUCATIONAL_LIMIT.
 */
export async function fetchUpcomingEducationalPrickles(
  supabase: SupabaseClient,
  now: Date,
): Promise<EducationalPrickle[]> {
  const windowEnd = new Date(now.getTime() + EDUCATIONAL_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const prickles = await createRepos(supabase).prickles.ofTypeActiveBetween({
    normalizedName: "educational",
    from: now.toISOString(),
    to: windowEnd.toISOString(),
    limit: EDUCATIONAL_LIMIT,
  });

  return prickles.map((p) => ({
    id: p.id,
    title: p.title ?? null,
    typeName: p.type?.name ?? "Educational Prickle",
    hostName: p.host?.name ?? null,
    startTime: p.startTime,
    endTime: p.endTime,
  }));
}
