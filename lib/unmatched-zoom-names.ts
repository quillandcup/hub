import { matchAttendeeToMember, type Member, type MemberAlias } from "./member-matching";

export interface UnmatchedZoomName {
  zoomName: string;
  appearances: number;
  emails: string[];
}

interface ZoomAttendeeRecord {
  name: string;
  email: string | null;
  meeting_uuid: string;
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
  staffMembers: StaffMember[] = []
): UnmatchedZoomName[] {
  const ignoredSet = new Set(ignoredNames);
  const staffEmails = new Set(staffMembers.map((s) => s.email.toLowerCase()));
  const staffNames = new Set(staffMembers.map((s) => s.name.toLowerCase()));

  // Count unique meetings (not total records) for each Zoom name
  const zoomNameCounts = new Map<string, { emails: Set<string>; meetings: Set<string> }>();
  for (const z of zoomAttendees) {
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
