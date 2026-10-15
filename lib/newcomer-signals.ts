import { SLACK_INTRO_CHANNEL } from "@/lib/config";

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
export async function loadAttendedMemberIds(supabase: any, memberIds: string[]): Promise<Set<string>> {
  const attended = new Set<string>();
  for (const chunk of chunks(memberIds)) {
    const ids = await fetchAllMemberIds((offset) =>
      supabase
        .from("prickle_attendance")
        .select("member_id")
        .in("member_id", chunk)
        .order("id")
        .range(offset, offset + BATCH_SIZE - 1)
    );
    for (const id of ids) attended.add(id);
  }
  return attended;
}

/**
 * memberId -> when they last attended a prickle, for those who ever have. Attendance rows are
 * per join, so a member has several; the latest join counts.
 */
export async function loadLastAttendanceByMember(supabase: any, memberIds: string[]): Promise<Map<string, Date>> {
  const last = new Map<string, Date>();
  for (const chunk of chunks(memberIds)) {
    let offset = 0;
    let hasMore = true;
    while (hasMore) {
      const { data } = await supabase
        .from("prickle_attendance")
        .select("member_id, join_time")
        .in("member_id", chunk)
        .order("id")
        .range(offset, offset + BATCH_SIZE - 1);
      for (const row of (data ?? []) as { member_id: string; join_time: string }[]) {
        const joined = new Date(row.join_time);
        const seen = last.get(row.member_id);
        if (!seen || joined > seen) last.set(row.member_id, joined);
      }
      offset += data?.length ?? 0;
      hasMore = (data?.length ?? 0) === BATCH_SIZE;
    }
  }
  return last;
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
