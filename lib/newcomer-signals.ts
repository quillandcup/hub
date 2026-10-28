import { SLACK_INTRO_CHANNEL } from "@/lib/config";
import type { AttendanceRepository } from "@/lib/data/attendance";
import { createRepos } from "@/lib/data/repos";

/**
 * What a newcomer has (or hasn't) done yet, read from the member's own data so the Getting started
 * tour (as the member) and the reminder job (as the service role) agree. Pass a client that can
 * read the members asked about.
 */

/**
 * Which of these members have posted a message (not a thread reply) in the intro channel. Read from
 * member_activities, which already has Slack users matched to members; its 'slack_message' type is
 * the top-level messages ('slack_thread_reply' is replies).
 */
export async function loadIntroducedMemberIds(supabase: any, memberIds: string[]): Promise<Set<string>> {
  return createRepos(supabase).activities.introducedIn(memberIds, SLACK_INTRO_CHANNEL);
}

/** Which of these members have attended at least one prickle. */
export function loadAttendedMemberIds(attendance: AttendanceRepository, memberIds: string[]): Promise<Set<string>> {
  return attendance.membersWhoAttended(memberIds);
}

/**
 * memberId -> when they last attended a prickle, for those who ever have. Attendance rows are
 * per join, so a member has several; the latest join counts.
 */
export function loadLastAttendanceByMember(attendance: AttendanceRepository, memberIds: string[]): Promise<Map<string, Date>> {
  return attendance.lastJoinByMember(memberIds);
}

/** Slack channel id of the intro channel, or null when the workspace has no such channel (yet). Bronze is admin-only, so pass a service-role client. */
export async function loadIntroChannelId(serviceRole: any): Promise<string | null> {
  const { data } = await serviceRole
    .schema("bronze")
    .from("slack_channels")
    .select("channel_id")
    .eq("name", SLACK_INTRO_CHANNEL)
    .limit(1)
    .maybeSingle();
  return (data?.channel_id as string | undefined) ?? null;
}
