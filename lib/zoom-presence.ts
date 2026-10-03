import { matchAttendeeToMember, type Member, type MemberAlias, type MemberEmailAlias } from "@/lib/member-matching";

/**
 * Live Zoom presence from the participant joined/left webhooks (bronze.zoom_participant_events,
 * migration 20261003150000). Zoom's Report API only covers ended meetings, so while a meeting
 * runs this is the only record of who's in the room. Used to send prickle check-outs at the
 * scheduled end and to early leavers (lib/prickle-checkin-dms.ts); the attendance import after
 * the meeting ends remains the source of truth.
 */

const BATCH_SIZE = 1000;

async function fetchAllPaginated<T>(queryFn: (offset: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  let all: T[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data } = await queryFn(offset);
    if (data && data.length > 0) {
      all = all.concat(data);
      offset += data.length;
      hasMore = data.length === BATCH_SIZE;
    } else {
      hasMore = false;
    }
  }
  return all;
}

export interface ParticipantEventRow {
  meeting_uuid: string;
  meeting_id: string | null;
  host_id: string | null;
  event: "joined" | "left";
  participant_key: string;
  participant_name: string | null;
  participant_email: string | null;
  event_time: string;
  leave_reason: string | null;
  raw_payload: unknown;
}

const PARTICIPANT_EVENTS: Record<string, "joined" | "left"> = {
  "meeting.participant_joined": "joined",
  "meeting.participant_left": "left",
};

/**
 * The row to record for a Zoom participant joined/left webhook, or null for any other event or a
 * payload missing what presence needs (meeting, participant, time). The event's own join/leave
 * time is used, falling back to Zoom's event timestamp.
 */
export function parseParticipantEvent(payload: any): ParticipantEventRow | null {
  const event = PARTICIPANT_EVENTS[payload?.event];
  const meeting = payload?.payload?.object;
  const participant = meeting?.participant;
  if (!event || !meeting?.uuid || !participant) return null;

  const key = participant.participant_uuid || participant.user_id || participant.id;
  const rawTime = (event === "joined" ? participant.join_time : participant.leave_time) ?? payload.event_ts;
  const time = typeof rawTime === "number" ? new Date(rawTime) : new Date(String(rawTime ?? ""));
  if (!key || Number.isNaN(time.getTime())) return null;

  return {
    meeting_uuid: String(meeting.uuid),
    meeting_id: meeting.id != null ? String(meeting.id) : null,
    host_id: meeting.host_id ? String(meeting.host_id) : null,
    event,
    participant_key: String(key),
    participant_name: participant.user_name ?? null,
    participant_email: participant.email || null,
    event_time: time.toISOString(),
    leave_reason: participant.leave_reason ?? null,
    raw_payload: payload,
  };
}

/** One stretch in the room: `leave` is null while they're still there (or the leave was lost). */
export interface PresenceInterval {
  join: number;
  leave: number | null;
}

/**
 * Pairs each participant's joins and leaves (by meeting + participant_key) into intervals, in
 * time order. A leave with no join before it (the join predates what was loaded, or was lost)
 * opens at -Infinity, so it still counts as having been there.
 */
export function pairIntervals(
  events: Pick<ParticipantEventRow, "meeting_uuid" | "participant_key" | "event" | "event_time">[]
): Map<string, PresenceInterval[]> {
  const byParticipant = new Map<string, { event: string; time: number }[]>();
  for (const e of events) {
    const key = `${e.meeting_uuid}\u0000${e.participant_key}`;
    const list = byParticipant.get(key) ?? [];
    list.push({ event: e.event, time: new Date(e.event_time).getTime() });
    byParticipant.set(key, list);
  }

  const result = new Map<string, PresenceInterval[]>();
  for (const [key, list] of byParticipant) {
    list.sort((a, b) => a.time - b.time || (a.event === "joined" ? -1 : 1));
    const intervals: PresenceInterval[] = [];
    let open: PresenceInterval | null = null;
    for (const e of list) {
      if (e.event === "joined") {
        if (!open) open = { join: e.time, leave: null };
      } else if (open) {
        open.leave = e.time;
        intervals.push(open);
        open = null;
      } else {
        intervals.push({ join: -Infinity, leave: e.time });
      }
    }
    if (open) intervals.push(open);
    result.set(key, intervals);
  }
  return result;
}

/** How long after a prickle's scheduled end everyone still there (or who stayed to the end) is checked out. */
export const CHECKOUT_AFTER_END_MS = 5 * 60 * 1000;
/** How long someone has to be gone, without rejoining, before an early leaver is checked out. */
export const EARLY_LEAVE_GRACE_MS = 10 * 60 * 1000;

/**
 * Whether a member with these intervals (across devices and meetings) is due a check-out for a
 * prickle running [start, end): they were in the room during it, and either the prickle ended
 * CHECKOUT_AFTER_END_MS ago, or they've left (no open interval) and been gone EARLY_LEAVE_GRACE_MS
 * -- so a bathroom break or a dropped connection doesn't count as leaving.
 */
export function presenceDue(intervals: PresenceInterval[], start: number, end: number, now: number): boolean {
  const overlapping = intervals.filter((i) => i.join < end && (i.leave === null || i.leave > start));
  if (overlapping.length === 0) return false;
  if (now >= end + CHECKOUT_AFTER_END_MS) return true;
  if (intervals.some((i) => i.leave === null)) return false;
  const lastLeave = Math.max(...intervals.map((i) => i.leave as number));
  return now >= lastLeave + EARLY_LEAVE_GRACE_MS;
}

/** How far back to look for the hosts the attendance import covers. */
const IMPORTED_HOSTS_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Zoom host ids of recently imported meetings (bronze.zoom_meetings): the rooms prickles run in.
 * The webhook subscription may cover every room on the Zoom account, including secondary rooms
 * the import doesn't read yet, and those must not count as being at a prickle (docs/TODO.md,
 * "Secondary Zoom rooms").
 */
async function loadImportedHostIds(supabase: any, now: Date): Promise<Set<string>> {
  const rows = await fetchAllPaginated<any>((offset) =>
    supabase
      .schema("bronze")
      .from("zoom_meetings")
      .select("id, host_id:data->>host_id")
      .gte("start_time", new Date(now.getTime() - IMPORTED_HOSTS_LOOKBACK_MS).toISOString())
      .order("id")
      .range(offset, offset + BATCH_SIZE - 1)
  );
  return new Set(rows.map((r) => r.host_id).filter((h): h is string => !!h));
}

/**
 * memberId -> presence intervals from participant events since `since`, in meetings hosted by a
 * host the attendance import covers, matched to members with matchAttendeeToMember on the same
 * members/aliases data as the attendance import (app/api/process/attendance). Unmatched or
 * ambiguous participants, and events with no host, are left out.
 */
export async function loadPresenceByMember(
  supabase: any,
  since: Date,
  now: Date = new Date()
): Promise<Map<string, PresenceInterval[]>> {
  const [allEvents, hostIds] = await Promise.all([
    fetchAllPaginated<any>((offset) =>
      supabase
        .schema("bronze")
        .from("zoom_participant_events")
        .select("id, meeting_uuid, host_id, participant_key, participant_name, participant_email, event, event_time")
        .gte("event_time", since.toISOString())
        .order("id")
        .range(offset, offset + BATCH_SIZE - 1)
    ),
    loadImportedHostIds(supabase, now),
  ]);
  const events = allEvents.filter((e) => e.host_id && hostIds.has(e.host_id));
  const result = new Map<string, PresenceInterval[]>();
  if (events.length === 0) return result;

  const [members, aliases, emailAliases] = await Promise.all([
    fetchAllPaginated<Member>((offset) =>
      supabase.from("members").select("id, name, email").order("id").range(offset, offset + BATCH_SIZE - 1)
    ),
    fetchAllPaginated<MemberAlias>((offset) =>
      supabase
        .from("member_name_aliases")
        .select("member_id, alias, source")
        .eq("active", true)
        .order("id")
        .range(offset, offset + BATCH_SIZE - 1)
    ),
    fetchAllPaginated<MemberEmailAlias>((offset) =>
      supabase
        .from("member_email_aliases")
        .select("alias_email, canonical_email")
        .eq("active", true)
        .order("id")
        .range(offset, offset + BATCH_SIZE - 1)
    ),
  ]);

  // One match per participant (name/email), not per event.
  const memberByParticipant = new Map<string, string | null>();
  for (const e of events) {
    const key = `${e.meeting_uuid}\u0000${e.participant_key}`;
    if (memberByParticipant.has(key) && memberByParticipant.get(key)) continue;
    const match = matchAttendeeToMember(e.participant_name ?? "", e.participant_email ?? null, members, aliases, emailAliases);
    memberByParticipant.set(key, match && "member_id" in match ? match.member_id : null);
  }

  for (const [key, intervals] of pairIntervals(events)) {
    const memberId = memberByParticipant.get(key);
    if (!memberId) continue;
    result.set(memberId, [...(result.get(memberId) ?? []), ...intervals]);
  }
  return result;
}
