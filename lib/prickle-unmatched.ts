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

/**
 * Given raw Zoom attendee records for a time window, returns names that couldn't
 * be matched to any member — for display on the prickle details page.
 *
 * Deduplicates by name, collects all seen emails, and filters out ignored names.
 */
export function findUnmatchedZoomAttendees(
  zoomAttendees: ZoomAttendeeRecord[],
  members: Member[],
  aliases: MemberAlias[],
  ignoredNames: string[]
): UnmatchedZoomAttendee[] {
  const ignoredSet = new Set(ignoredNames);

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
