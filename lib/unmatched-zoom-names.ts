import { matchAttendeeToMember, type Member, type MemberAlias } from "./member-matching";

export interface UnmatchedZoomName {
  zoomName: string;
  appearances: number;
  emails: string[];
}

interface ZoomAttendeeRecord {
  name: string;
  email: string | null;
  meeting_uuid: string | null;
  join_time?: string;
  leave_time?: string;
}

/** A Zoom name ignored for one prickle only: its appearances inside that prickle's window don't count. */
export interface IgnoredAppearance {
  zoomName: string;
  startTime: string;
  endTime: string;
}

interface StaffMember {
  name: string;
  email: string;
}

/**
 * All-time unmatched Zoom names across every attendee record — the same
 * computation backing /admin/hygiene/unmatched-zoom, extracted so the Data
 * Health dashboard can show a matching count without duplicating the logic.
 */
export function computeUnmatchedZoomNames(
  zoomAttendees: ZoomAttendeeRecord[],
  members: Member[],
  aliases: MemberAlias[],
  ignoredNames: string[],
  staffMembers: StaffMember[] = [],
  ignoredAppearances: IgnoredAppearance[] = []
): UnmatchedZoomName[] {
  const ignoredSet = new Set(ignoredNames);
  const windowsByName = new Map<string, { start: number; end: number }[]>();
  for (const a of ignoredAppearances) {
    const list = windowsByName.get(a.zoomName) ?? [];
    list.push({ start: Date.parse(a.startTime), end: Date.parse(a.endTime) });
    windowsByName.set(a.zoomName, list);
  }
  const ignoredHere = (z: ZoomAttendeeRecord) => {
    if (!z.join_time || !z.leave_time) return false;
    const join = Date.parse(z.join_time);
    const leave = Date.parse(z.leave_time);
    return (windowsByName.get(z.name) ?? []).some((w) => join < w.end && leave > w.start);
  };
  const staffEmails = new Set(staffMembers.map((s) => s.email.toLowerCase()));
  const staffNames = new Set(staffMembers.map((s) => s.name.toLowerCase()));

  // Count unique meetings (not total records) for each Zoom name
  const zoomNameCounts = new Map<string, { emails: Set<string>; meetings: Set<string> }>();
  for (const z of zoomAttendees) {
    if (ignoredHere(z)) continue;
    const existing = zoomNameCounts.get(z.name);
    if (existing) {
      if (z.meeting_uuid) existing.meetings.add(z.meeting_uuid);
      if (z.email) existing.emails.add(z.email);
    } else {
      zoomNameCounts.set(z.name, {
        emails: new Set(z.email ? [z.email] : []),
        meetings: new Set(z.meeting_uuid ? [z.meeting_uuid] : []),
      });
    }
  }

  const unmatched: UnmatchedZoomName[] = [];
  for (const [zoomName, info] of zoomNameCounts) {
    if (ignoredSet.has(zoomName)) continue;

    const zoomEmail = info.emails.size > 0 ? Array.from(info.emails)[0]?.toLowerCase() : null;
    if (staffNames.has(zoomName.toLowerCase()) || (zoomEmail && staffEmails.has(zoomEmail))) continue;

    const email = info.emails.size > 0 ? Array.from(info.emails)[0] : null;
    const matchResult = matchAttendeeToMember(zoomName, email, members, aliases);

    if (!matchResult) {
      unmatched.push({
        zoomName,
        appearances: info.meetings.size,
        emails: Array.from(info.emails),
      });
    }
  }

  return unmatched;
}
