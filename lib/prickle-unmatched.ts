import { matchAttendeeToMember, type Member, type MemberAlias } from "./member-matching";

interface ZoomAttendeeRecord {
  name: string;
  email: string | null;
}

export interface UnmatchedZoomAttendee {
  zoomName: string;
  appearances: number;
  emails: string[];
}

export interface MatchedWithoutAttendance {
  memberId: string;
  memberName: string;
  zoomName: string;
}

/**
 * Given raw Zoom attendee records for a time window, returns names that couldn't
 * be matched to any member — for display on the prickle details page.
 *
 * Deduplicates by name, collects all seen emails, and filters out ignored names.
 */
interface StaffMember {
  name: string;
  email: string;
}

export function findUnmatchedZoomAttendees(
  zoomAttendees: ZoomAttendeeRecord[],
  members: Member[],
  aliases: MemberAlias[],
  ignoredNames: string[],
  staffMembers: StaffMember[] = []
): UnmatchedZoomAttendee[] {
  const ignoredSet = new Set(ignoredNames);
  const staffEmails = new Set(staffMembers.map(s => s.email.toLowerCase()));
  const staffNames = new Set(staffMembers.map(s => s.name.toLowerCase()));

  const nameMap = new Map<string, { emails: Set<string>; count: number }>();
  for (const a of zoomAttendees) {
    const existing = nameMap.get(a.name);
    if (existing) {
      if (a.email) existing.emails.add(a.email);
      existing.count++;
    } else {
      nameMap.set(a.name, { emails: new Set(a.email ? [a.email] : []), count: 1 });
    }
  }

  const unmatched: UnmatchedZoomAttendee[] = [];
  for (const [zoomName, info] of nameMap) {
    if (ignoredSet.has(zoomName)) continue;
    const email = info.emails.size > 0 ? Array.from(info.emails)[0] : null;
    if (staffNames.has(zoomName.toLowerCase()) || (email && staffEmails.has(email.toLowerCase()))) continue;
    const match = matchAttendeeToMember(zoomName, email, members, aliases);
    if (!match) {
      unmatched.push({
        zoomName,
        appearances: info.count,
        emails: Array.from(info.emails),
      });
    }
  }

  return unmatched;
}

/**
 * Given raw Zoom attendee records for a time window and the set of member IDs
 * that already have prickle_attendance records, returns members who were
 * recognized in Zoom but are missing an attendance record.
 *
 * This surfaces the "state 3" gap: person matched a member but attendance
 * processing never created their record (e.g. they were inactive at processing
 * time, or processing ran before their member record existed).
 */
export function findMatchedZoomAttendeesWithoutAttendance(
  zoomAttendees: ZoomAttendeeRecord[],
  members: Member[],
  aliases: MemberAlias[],
  ignoredNames: string[],
  staffMembers: StaffMember[],
  attendedMemberIds: Set<string>
): MatchedWithoutAttendance[] {
  const ignoredSet = new Set(ignoredNames);
  const staffEmails = new Set(staffMembers.map(s => s.email.toLowerCase()));
  const staffNames = new Set(staffMembers.map(s => s.name.toLowerCase()));

  // Deduplicate by name, collect emails (same grouping as findUnmatchedZoomAttendees)
  const nameMap = new Map<string, { emails: Set<string> }>();
  for (const a of zoomAttendees) {
    const existing = nameMap.get(a.name);
    if (existing) {
      if (a.email) existing.emails.add(a.email);
    } else {
      nameMap.set(a.name, { emails: new Set(a.email ? [a.email] : []) });
    }
  }

  const seenMemberIds = new Set<string>();
  const result: MatchedWithoutAttendance[] = [];

  for (const [zoomName, info] of nameMap) {
    if (ignoredSet.has(zoomName)) continue;
    const email = info.emails.size > 0 ? Array.from(info.emails)[0] : null;
    if (staffNames.has(zoomName.toLowerCase()) || (email && staffEmails.has(email.toLowerCase()))) continue;

    const match = matchAttendeeToMember(zoomName, email, members, aliases);
    if (match && 'member_id' in match) {
      const { member_id } = match;
      if (!attendedMemberIds.has(member_id) && !seenMemberIds.has(member_id)) {
        seenMemberIds.add(member_id);
        const member = members.find(m => m.id === member_id);
        if (member) result.push({ memberId: member_id, memberName: member.name, zoomName });
      }
    }
  }

  return result;
}
