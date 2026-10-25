import type { AttendanceLink } from "@/lib/data/attendance";

/** How often a member has attended and when they last joined. */
export type AttendanceSummary = { count: number; lastJoin: Date };

/** Attendance records folded into one summary per member; members with none are absent. */
export function summarizeAttendance(links: Pick<AttendanceLink, "memberId" | "joinTime">[]): Map<string, AttendanceSummary> {
  const summaries = new Map<string, AttendanceSummary>();
  for (const { memberId, joinTime } of links) {
    const joined = new Date(joinTime);
    const existing = summaries.get(memberId);
    if (!existing) summaries.set(memberId, { count: 1, lastJoin: joined });
    else {
      existing.count++;
      if (joined > existing.lastJoin) existing.lastJoin = joined;
    }
  }
  return summaries;
}

/**
 * An active member with no attendance since `since`. Staff-only accounts (source "staff", no paying
 * Kajabi subscription) are not worried about churning; staff who also pay keep source "kajabi" and
 * stay eligible.
 */
export function isAtRisk(member: { source: string }, summary: AttendanceSummary | undefined, since: Date): boolean {
  if (member.source === "staff") return false;
  return !summary || summary.lastJoin < since;
}
