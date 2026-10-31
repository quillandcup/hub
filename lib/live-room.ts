import { createRepos } from "@/lib/data/repos";
import { matchAttendeeToMember, type MemberAlias, type MemberEmailAlias } from "@/lib/member-matching";
import { getMemberDisplayName } from "@/lib/member-display-name";
import { joinAt, loadPrickleJoinSettings, type PrickleJoin } from "@/lib/prickle-join";
import { loadImportedHostIds, pairIntervals, type ParticipantEventRow } from "@/lib/zoom-presence";

/**
 * Who's on the Prickle link right now, for the "On air" light in the member header.
 * Built from the participant joined/left webhooks (bronze.zoom_participant_events, see
 * lib/zoom-presence.ts), so it is only as live as those events are.
 */

/** Events older than this are ignored: a lost "left" webhook must not leave someone "in the room" for good. */
export const LIVE_WINDOW_MS = 12 * 60 * 60 * 1000;

type LiveEvent = Pick<
  ParticipantEventRow,
  "meeting_uuid" | "participant_key" | "participant_name" | "participant_email" | "event" | "event_time"
>;

export interface LiveParticipant {
  key: string;
  name: string | null;
  email: string | null;
}

/** Participants whose latest stretch in a meeting has no leave yet, one entry per participant per meeting. */
export function openParticipants(events: LiveEvent[], now: number = Date.now()): LiveParticipant[] {
  const since = now - LIVE_WINDOW_MS;
  const recent = events.filter((e) => new Date(e.event_time).getTime() >= since);
  const latest = new Map<string, LiveEvent>();
  for (const e of recent) latest.set(`${e.meeting_uuid}\u0000${e.participant_key}`, e);
  const open: LiveParticipant[] = [];
  for (const [key, intervals] of pairIntervals(recent)) {
    if (!intervals.some((i) => i.leave === null)) continue;
    const e = latest.get(key)!;
    open.push({ key, name: e.participant_name, email: e.participant_email });
  }
  return open;
}

export interface LiveRoomMember {
  memberId: string;
  name: string;
}

export interface LiveRoomPrickle {
  id: string;
  title: string;
  hostName: string | null;
}

export interface LiveRoom {
  live: boolean;
  /** Everyone in the room, members and guests. */
  count: number;
  members: LiveRoomMember[];
  /** People in the room who aren't matched to a member (counted in `count`). */
  guests: number;
  /** The scheduled Prickle running now, if any. Null for a Pop-Up Prickle (PUP) or an empty room. */
  prickle: LiveRoomPrickle | null;
  join: PrickleJoin | null;
}

/** Reads participant events, so it needs the service role client (the table is service role only). */
export async function loadLiveRoom(supabase: any, now: Date = new Date()): Promise<LiveRoom> {
  const [events, hostIds, settings] = await Promise.all([
    createRepos(supabase).zoom.participantEventsSince(new Date(now.getTime() - LIVE_WINDOW_MS).toISOString()),
    loadImportedHostIds(supabase, now),
    loadPrickleJoinSettings(supabase),
  ]);
  const join = joinAt(settings, now);
  const open = openParticipants(
    events.filter((e) => e.host_id && hostIds.has(e.host_id)),
    now.getTime()
  );
  if (open.length === 0) return { live: false, count: 0, members: [], guests: 0, prickle: null, join };

  const [members, aliases, emailAliases, running] = await Promise.all([
    createRepos(supabase)
      .members.identities()
      .then((rows) => rows.map((m) => ({ id: m.id, name: m.name, email: m.email, display_name: m.displayName }))),
    createRepos(supabase).aliases.nameAliases({ activeOnly: true }),
    createRepos(supabase).aliases.emailAliases({ activeOnly: true }),
    createRepos(supabase).prickles.inProgressAt(now.toISOString()),
  ]);

  const byId = new Map(members.map((m) => [m.id, m]));
  const seen = new Set<string>();
  const inRoom: LiveRoomMember[] = [];
  let guests = 0;
  for (const p of open) {
    const match = matchAttendeeToMember(p.name ?? "", p.email, members, aliases, emailAliases);
    const memberId = match && "member_id" in match ? match.member_id : null;
    const member = memberId ? byId.get(memberId) : undefined;
    if (!member) guests += 1;
    else if (!seen.has(member.id)) {
      seen.add(member.id);
      inRoom.push({ memberId: member.id, name: getMemberDisplayName(member) });
    }
  }
  inRoom.sort((a, b) => a.name.localeCompare(b.name));

  return {
    live: true,
    count: inRoom.length + guests,
    members: inRoom,
    guests,
    prickle: running ? { id: running.id, title: running.title || running.type?.name || "Prickle", hostName: running.host ? getMemberDisplayName({ name: running.host.name, display_name: running.host.displayName }) : null } : null,
    join,
  };
}
