import type { createClient } from "@/lib/supabase/server";

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

type NameRef = { name: string } | { name: string }[] | null;

type RawEducational = {
  id: string;
  title: string | null;
  start_time: string;
  end_time: string;
  host: NameRef;
  prickle_types: NameRef;
};

function unwrapName(ref: NameRef): string | null {
  if (Array.isArray(ref)) return ref[0]?.name ?? null;
  return ref?.name ?? null;
}

/**
 * Educational prickles that haven't ended yet (`end_time >= now`, so one in progress still
 * shows) and start within the next EDUCATIONAL_WINDOW_DAYS, soonest first, capped at
 * EDUCATIONAL_LIMIT. The `prickle_types!inner` embed makes the normalized_name filter
 * exclude non-educational prickles rather than just nulling out their embedded type.
 */
export async function fetchUpcomingEducationalPrickles(
  supabase: SupabaseClient,
  now: Date,
): Promise<EducationalPrickle[]> {
  const windowEnd = new Date(now.getTime() + EDUCATIONAL_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const { data } = await supabase
    .from("prickles")
    .select("id, title, start_time, end_time, host:members(name), prickle_types!inner(name, normalized_name)")
    .eq("prickle_types.normalized_name", "educational")
    .gte("end_time", now.toISOString())
    .lte("start_time", windowEnd.toISOString())
    .order("start_time", { ascending: true })
    .limit(EDUCATIONAL_LIMIT);

  return ((data ?? []) as unknown as RawEducational[]).map((p) => ({
    id: p.id,
    title: p.title ?? null,
    typeName: unwrapName(p.prickle_types) ?? "Educational Prickle",
    hostName: unwrapName(p.host),
    startTime: p.start_time,
    endTime: p.end_time,
  }));
}
