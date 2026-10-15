import type { SupabaseClient } from "@supabase/supabase-js";
import { localDateFor, normalizeTime, SCHEDULE_TIMEZONE, slotTimeForInstant } from "@/lib/commitments";
import { getMemberDisplayName } from "@/lib/member-display-name";

/**
 * "Who's coming" for a prickle that hasn't started: a soft sign-up built from what members already
 * do. Someone is listed when they
 *  - committed to the prickle's weekly slot (an active commitment whose window covers its date), or
 *  - added it to their calendar, either just this one or its weekly slot.
 * Commitments and calendar items are private to each member (RLS), so this reads them with the
 * service role and hands back only names. A member can opt out (member_roster_opt_outs); they then
 * show only to themselves, marked as hidden. Hosts aren't listed here: the page names the host.
 */

export type RosterReason = "committed" | "calendar";

export interface RosterEntry {
  memberId: string;
  name: string;
  /** Committing outranks adding to a calendar. */
  reason: RosterReason;
  isYou: boolean;
  /** Only ever true for the viewer: they opted out, so others don't see them. */
  hiddenFromOthers: boolean;
}

export interface PrickleRoster {
  entries: RosterEntry[];
  /** Everyone who'd be listed to the viewer, including those cut off by ROSTER_LIMIT. */
  total: number;
}

/** A long list is cut off here, the viewer first. */
export const ROSTER_LIMIT = 60;

export interface RosterPrickle {
  type_id: string | null;
  start_time: string;
  id: string;
}

const BATCH_SIZE = 1000;
// Keeps each `.in(...)` URL well under PostgREST's length limit.
const ID_CHUNK = 200;

async function fetchAll<T>(queryFn: (from: number, to: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += BATCH_SIZE) {
    const { data } = await queryFn(offset, offset + BATCH_SIZE - 1);
    rows.push(...(data ?? []));
    if (!data || data.length < BATCH_SIZE) return rows;
  }
}

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += ID_CHUNK) out.push(items.slice(i, i + ID_CHUNK));
  return out;
}

interface CommitmentSlotRow {
  start_time_local: string;
  prickle_commitments: { member_id: string; status: string; start_date: string; end_date: string } | { member_id: string; status: string; start_date: string; end_date: string }[] | null;
}

export async function loadPrickleRoster(
  service: SupabaseClient,
  prickle: RosterPrickle,
  viewerMemberId: string | null
): Promise<PrickleRoster> {
  if (!prickle.type_id) return { entries: [], total: 0 };
  const typeId = prickle.type_id;
  const slot = slotTimeForInstant(prickle.start_time, SCHEDULE_TIMEZONE);
  const startTimeLocal = normalizeTime(slot.startTimeLocal);
  const localDate = localDateFor(new Date(prickle.start_time), SCHEDULE_TIMEZONE);

  const [committedRows, onceRows, weeklyRows] = await Promise.all([
    fetchAll<CommitmentSlotRow>((from, to) =>
      service
        .from("prickle_commitment_slots")
        .select("start_time_local, prickle_commitments!inner(member_id, status, start_date, end_date)")
        .eq("type_id", typeId)
        .eq("day_of_week", slot.dayOfWeek)
        .eq("timezone", SCHEDULE_TIMEZONE)
        .order("id")
        .range(from, to)
    ),
    fetchAll<{ member_id: string }>((from, to) =>
      service
        .from("calendar_feed_items")
        .select("member_id")
        .eq("kind", "prickle")
        .eq("prickle_id", prickle.id)
        .order("id")
        .range(from, to)
    ),
    fetchAll<{ member_id: string; start_time_local: string }>((from, to) =>
      service
        .from("calendar_feed_items")
        .select("member_id, start_time_local")
        .eq("kind", "slot")
        .eq("type_id", typeId)
        .eq("day_of_week", slot.dayOfWeek)
        .eq("timezone", SCHEDULE_TIMEZONE)
        .order("id")
        .range(from, to)
    ),
  ]);

  const reasonByMember = new Map<string, RosterReason>();
  for (const row of weeklyRows) {
    if (normalizeTime(row.start_time_local) === startTimeLocal) reasonByMember.set(row.member_id, "calendar");
  }
  for (const row of onceRows) reasonByMember.set(row.member_id, "calendar");
  for (const row of committedRows) {
    if (normalizeTime(row.start_time_local) !== startTimeLocal) continue;
    const commitment = Array.isArray(row.prickle_commitments) ? row.prickle_commitments[0] : row.prickle_commitments;
    if (!commitment || commitment.status !== "active") continue;
    if (localDate < commitment.start_date || localDate > commitment.end_date) continue;
    reasonByMember.set(commitment.member_id, "committed");
  }
  if (reasonByMember.size === 0) return { entries: [], total: 0 };

  const memberIds = [...reasonByMember.keys()];
  const [hidden, members] = await Promise.all([
    Promise.all(
      chunks(memberIds).map(async (ids) => (await service.from("member_roster_opt_outs").select("member_id").in("member_id", ids)).data ?? [])
    ),
    Promise.all(
      chunks(memberIds).map(
        async (ids) => (await service.from("members").select("id, name, display_name, status").in("id", ids)).data ?? []
      )
    ),
  ]);
  const hiddenIds = new Set(hidden.flat().map((r: { member_id: string }) => r.member_id));

  const entries: RosterEntry[] = [];
  for (const m of members.flat() as { id: string; name: string; display_name: string | null; status: string }[]) {
    if (m.status === "cancelled") continue;
    const isYou = m.id === viewerMemberId;
    const isHidden = hiddenIds.has(m.id);
    if (isHidden && !isYou) continue;
    entries.push({
      memberId: m.id,
      name: getMemberDisplayName(m),
      reason: reasonByMember.get(m.id)!,
      isYou,
      hiddenFromOthers: isHidden,
    });
  }

  // You first, then those who committed (a firmer sign-up), then alphabetically.
  entries.sort(
    (a, b) =>
      Number(b.isYou) - Number(a.isYou) ||
      Number(b.reason === "committed") - Number(a.reason === "committed") ||
      a.name.localeCompare(b.name)
  );
  return { entries: entries.slice(0, ROSTER_LIMIT), total: entries.length };
}
