import { createRepos } from "@/lib/data/repos";
import type { WeeklySlotMember } from "@/lib/data/calendar-feed";
import type { SlotCommitment } from "@/lib/data/prickle-activity";
import type { SupabaseClient } from "@supabase/supabase-js";
import { localDateFor, normalizeTime, SCHEDULE_TIMEZONE, slotTimeForInstant } from "@/lib/commitments";
import { getMemberDisplayName } from "@/lib/member-display-name";

/**
 * "Who's coming" for a prickle that hasn't started: a soft sign-up built from what members already
 * do. Someone is listed when they
 *  - committed to the prickle's weekly slot (an active commitment whose window covers its date), or
 *  - added it to their calendar, either just this one or its weekly slot.
 * plus the host, who is public already (the page names them) and so never hidden.
 * Commitments and calendar items are private to each member (RLS), so this reads them with the
 * service role and hands back only names. A member can opt out (member_roster_opt_outs); they then
 * show only to themselves, marked as hidden.
 */

export type RosterReason = "host" | "committed" | "calendar";

export interface RosterEntry {
  memberId: string;
  name: string;
  /** Hosting outranks committing, which outranks adding to a calendar. */
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
  /** Member id of the host, if it has one. */
  host_id?: string | null;
}

// Keeps each `.in(...)` URL well under PostgREST's length limit.
const ID_CHUNK = 200;

function calendarReadFailed<T>(error: unknown): T[] {
  console.error("prickle roster: failed to read calendar items", error);
  return [];
}

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += ID_CHUNK) out.push(items.slice(i, i + ID_CHUNK));
  return out;
}

export async function loadPrickleRoster(
  service: SupabaseClient,
  prickle: RosterPrickle,
  viewerMemberId: string | null
): Promise<PrickleRoster> {
  // Commitments and weekly calendar items are about a slot (type + weekday + time), so a prickle with
  // no type has none; just this one can still be added, and it can still have a host.
  const typeId = prickle.type_id;
  const slot = slotTimeForInstant(prickle.start_time, SCHEDULE_TIMEZONE);
  const startTimeLocal = normalizeTime(slot.startTimeLocal);
  const localDate = localDateFor(new Date(prickle.start_time), SCHEDULE_TIMEZONE);

  const repos = createRepos(service);
  const [committedRows, onceMemberIds, weeklyRows] = await Promise.all([
    typeId
      ? repos.prickleActivity.slotCommitments({ typeId, dayOfWeek: slot.dayOfWeek, timezone: SCHEDULE_TIMEZONE })
      : Promise.resolve([] as SlotCommitment[]),
    // A failed read lists nobody from the calendar rather than failing the page.
    repos.calendarFeed.memberIdsWithPrickle(prickle.id).catch(calendarReadFailed<string>),
    typeId
      ? repos.calendarFeed.weeklySlotMembers({ typeId, dayOfWeek: slot.dayOfWeek, timezone: SCHEDULE_TIMEZONE }).catch(calendarReadFailed<WeeklySlotMember>)
      : Promise.resolve([] as WeeklySlotMember[]),
  ]);

  const reasonByMember = new Map<string, RosterReason>();
  for (const row of weeklyRows) {
    if (normalizeTime(row.startTimeLocal) === startTimeLocal) reasonByMember.set(row.memberId, "calendar");
  }
  for (const memberId of onceMemberIds) reasonByMember.set(memberId, "calendar");
  for (const row of committedRows) {
    if (normalizeTime(row.startTimeLocal) !== startTimeLocal) continue;
    if (row.status !== "active") continue;
    if (localDate < row.startDate || localDate > row.endDate) continue;
    reasonByMember.set(row.memberId, "committed");
  }
  if (prickle.host_id) reasonByMember.set(prickle.host_id, "host");
  if (reasonByMember.size === 0) return { entries: [], total: 0 };

  const memberIds = [...reasonByMember.keys()];
  const [hidden, members] = await Promise.all([
    Promise.all(
      chunks(memberIds).map(async (ids) => (await service.from("member_roster_opt_outs").select("member_id").in("member_id", ids)).data ?? [])
    ),
    createRepos(service).members.byIds(memberIds),
  ]);
  const hiddenIds = new Set(hidden.flat().map((r: { member_id: string }) => r.member_id));

  const entries: RosterEntry[] = [];
  for (const m of members) {
    if (m.status === "cancelled") continue;
    const isYou = m.id === viewerMemberId;
    const reason = reasonByMember.get(m.id)!;
    // The host is named on the page anyway, so opting out doesn't apply to hosting.
    const isHidden = hiddenIds.has(m.id) && reason !== "host";
    if (isHidden && !isYou) continue;
    entries.push({ memberId: m.id, name: getMemberDisplayName({ name: m.name, display_name: m.displayName }), reason, isYou, hiddenFromOthers: isHidden });
  }

  // The host, then you, then those who committed (a firmer sign-up), then alphabetically.
  const rank = (e: RosterEntry) => (e.reason === "host" ? 0 : e.isYou ? 1 : e.reason === "committed" ? 2 : 3);
  entries.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  return { entries: entries.slice(0, ROSTER_LIMIT), total: entries.length };
}
