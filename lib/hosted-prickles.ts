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
  /** When true, also returns the distinct attendee count per hosted prickle. Aggregated in
   * Postgres by get_hosted_prickle_attendance (one row per hosted prickle), so this never pulls
   * other members' attendance rows over the wire. Leave off when only punctuality is needed. */
  includeAttendeeCounts?: boolean;
}

/** Row shape returned by the get_hosted_prickle_attendance RPC
 * (supabase/migrations/20260926000500_add_get_hosted_prickle_attendance.sql). */
export interface HostedPrickleAttendanceRow {
  prickle_id: string;
  start_time: string;
  end_time: string;
  type_name: string | null;
  host_earliest_join: string | null;
  attendee_count: number | null;
}

/** Pure mapping from the RPC's rows to HostedPrickleRecord, same shape the host-only path
 * produces plus attendeeCount. */
export function mapHostedPrickleAttendanceRows(rows: HostedPrickleAttendanceRow[]): HostedPrickleRecord[] {
  return rows.map((r) => ({
    prickleId: r.prickle_id,
    typeName: r.type_name ?? "Prickle",
    startTime: r.start_time,
    endTime: r.end_time,
    earliestJoinTime: r.host_earliest_join,
    attendeeCount: r.attendee_count ?? 0,
  }));
}

async function fetchHostedPrickleAttendance(
  supabase: SupabaseClient,
  memberId: string,
  nowIso: string
): Promise<HostedPrickleRecord[]> {
  // One row per hosted prickle; a prolific host can still pass PostgREST's 1000-row cap, so
  // page with .range() over the function's deterministic (start_time, id) order.
  let rows: HostedPrickleAttendanceRow[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data: batch, error } = await supabase
      .rpc("get_hosted_prickle_attendance", { p_host_id: memberId, p_started_before: nowIso })
      .range(offset, offset + BATCH_SIZE - 1);
    if (error) {
      console.error("get_hosted_prickle_attendance failed", { memberId, error: error.message });
      throw new Error(`Failed to load hosting stats: ${error.message}`);
    }
    const page = (batch ?? []) as HostedPrickleAttendanceRow[];
    rows = rows.concat(page);
    offset += page.length;
    hasMore = page.length === BATCH_SIZE;
  }
  return mapHostedPrickleAttendanceRows(rows);
}

/**
 * Every prickle `memberId` has hosted that has already started, with the host's earliest
 * join_time (a host can leave and rejoin, per CLAUDE.md's attendance model) and optionally the
 * distinct attendee count. Future scheduled prickles (already synced from the calendar) haven't
 * happened yet, so they're excluded. Paginated per CLAUDE.md: prickles and prickle_attendance
 * can each exceed 1000 rows.
 *
 * With includeAttendeeCounts the whole thing is one aggregated RPC (O(hosted prickles) rows);
 * without it, two host-scoped queries (the host's own prickles, then only the host's own
 * attendance rows) -- the path getMyHostingStats uses, unchanged.
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
  // CI pushes migrations before deploying, so the RPC always exists; an error is a real failure.
  if (includeAttendeeCounts) return fetchHostedPrickleAttendance(supabase, memberId, nowIso);

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

  for (let i = 0; i < prickleIds.length; i += PRICKLE_ID_BATCH) {
    const idBatch = prickleIds.slice(i, i + PRICKLE_ID_BATCH);
    let offset = 0;
    let hasMore = true;
    while (hasMore) {
      const { data: batch } = await supabase
        .from("prickle_attendance")
        .select("prickle_id, join_time")
        .eq("member_id", memberId)
        .in("prickle_id", idBatch)
        .range(offset, offset + BATCH_SIZE - 1);
      if (batch && batch.length > 0) {
        for (const row of batch as { prickle_id: string; join_time: string }[]) {
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
  }));
}
