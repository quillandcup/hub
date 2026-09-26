import type { createClient } from "@/lib/supabase/server";
import type { HostedPrickleRecord } from "@/lib/hosting-stats";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

const BATCH_SIZE = 1000;
const PRICKLE_ID_BATCH = 100;

type HostedPrickleRow = {
  id: string;
  start_time: string;
  end_time: string;
  prickle_types: { name: string } | null;
};

export interface FetchHostedPrickleOptions {
  now?: Date;
  /** When true, also counts distinct attendees per hosted prickle (fetches every attendee's
   * rows, not just the host's). Leave off when only punctuality is needed. */
  includeAttendeeCounts?: boolean;
}

/**
 * Every prickle `memberId` has hosted that has already started, with the host's earliest
 * join_time (a host can leave and rejoin, per CLAUDE.md's attendance model) and optionally the
 * distinct attendee count. Future scheduled prickles (already synced from the calendar) haven't
 * happened yet, so they're excluded. Paginated per CLAUDE.md: prickles and prickle_attendance
 * can each exceed 1000 rows.
 *
 * Shared by the host's own stats (getMyHostingStats) and the public member profile, so callers
 * pass the member id explicitly -- resolving *which* member is the caller's job.
 */
export async function fetchHostedPrickleRecords(
  supabase: SupabaseClient,
  memberId: string,
  { now = new Date(), includeAttendeeCounts = false }: FetchHostedPrickleOptions = {}
): Promise<HostedPrickleRecord[]> {
  const nowIso = now.toISOString();

  let hostedPrickles: HostedPrickleRow[] = [];
  {
    let offset = 0;
    let hasMore = true;
    while (hasMore) {
      const { data: batch } = await supabase
        .from("prickles")
        .select("id, start_time, end_time, prickle_types:type_id(name)")
        .eq("host", memberId)
        .lte("start_time", nowIso)
        .range(offset, offset + BATCH_SIZE - 1);
      if (batch && batch.length > 0) {
        hostedPrickles = hostedPrickles.concat(batch as unknown as HostedPrickleRow[]);
        offset += batch.length;
        hasMore = batch.length === BATCH_SIZE;
      } else {
        hasMore = false;
      }
    }
  }

  if (hostedPrickles.length === 0) return [];

  const prickleIds = hostedPrickles.map((p) => p.id);
  const earliestJoinByPrickle = new Map<string, string>();
  const attendeesByPrickle = new Map<string, Set<string>>();

  for (let i = 0; i < prickleIds.length; i += PRICKLE_ID_BATCH) {
    const idBatch = prickleIds.slice(i, i + PRICKLE_ID_BATCH);
    let offset = 0;
    let hasMore = true;
    while (hasMore) {
      const base = supabase.from("prickle_attendance").select("prickle_id, member_id, join_time");
      const scoped = includeAttendeeCounts ? base : base.eq("member_id", memberId);
      const { data: batch } = await scoped.in("prickle_id", idBatch).range(offset, offset + BATCH_SIZE - 1);
      if (batch && batch.length > 0) {
        for (const row of batch as { prickle_id: string; member_id: string; join_time: string }[]) {
          if (includeAttendeeCounts) {
            const set = attendeesByPrickle.get(row.prickle_id) ?? new Set<string>();
            set.add(row.member_id);
            attendeesByPrickle.set(row.prickle_id, set);
          }
          if (row.member_id !== memberId) continue;
          const existing = earliestJoinByPrickle.get(row.prickle_id);
          if (!existing || row.join_time < existing) earliestJoinByPrickle.set(row.prickle_id, row.join_time);
        }
        offset += batch.length;
        hasMore = batch.length === BATCH_SIZE;
      } else {
        hasMore = false;
      }
    }
  }

  return hostedPrickles.map((p) => ({
    prickleId: p.id,
    typeName: p.prickle_types?.name ?? "Prickle",
    startTime: p.start_time,
    endTime: p.end_time,
    earliestJoinTime: earliestJoinByPrickle.get(p.id) ?? null,
    ...(includeAttendeeCounts ? { attendeeCount: attendeesByPrickle.get(p.id)?.size ?? 0 } : {}),
  }));
}
