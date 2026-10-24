import { SLACK_INTRO_CHANNEL } from "@/lib/config";
import type { AttendanceRepository } from "@/lib/data/attendance";

/**
 * What a newcomer has (or hasn't) done yet, read from the member's own data so the Getting started
 * tour (as the member) and the reminder job (as the service role) agree. Pass a client that can
 * read the members asked about.
 */

const BATCH_SIZE = 1000;
// Keeps each `.in("member_id", ...)` URL well under PostgREST's length limit.
const MEMBER_ID_CHUNK = 200;

async function fetchAllMemberIds(
  queryFn: (offset: number) => PromiseLike<{ data: { member_id: string }[] | null }>
): Promise<Set<string>> {
  const ids = new Set<string>();
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data } = await queryFn(offset);
    if (data && data.length > 0) {
      for (const row of data) ids.add(row.member_id);
      offset += data.length;
      hasMore = data.length === BATCH_SIZE;
    } else {
      hasMore = false;
    }
  }
  return ids;
}

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += MEMBER_ID_CHUNK) out.push(items.slice(i, i + MEMBER_ID_CHUNK));
  return out;
}

/**
 * Which of these members have posted a message (not a thread reply) in the intro channel. Read from
 * member_activities, which already has Slack users matched to members; its 'slack_message' type is
 * the top-level messages ('slack_thread_reply' is replies).
 */
export async function loadIntroducedMemberIds(supabase: any, memberIds: string[]): Promise<Set<string>> {
  const introduced = new Set<string>();
  for (const chunk of chunks(memberIds)) {
    const ids = await fetchAllMemberIds((offset) =>
      supabase
        .from("member_activities")
        .select("member_id")
        .in("member_id", chunk)
        .eq("source", "slack")
        .eq("activity_type", "slack_message")
        .eq("data->>channel_name", SLACK_INTRO_CHANNEL)
        .order("id")
        .range(offset, offset + BATCH_SIZE - 1)
    );
    for (const id of ids) introduced.add(id);
  }
  return introduced;
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
