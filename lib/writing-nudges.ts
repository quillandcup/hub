import { matchSlackUsersToMembers } from "@/lib/slack-matching";
import { sendSlackDM } from "@/lib/slack";
import { MEASURE_QUICK_LOG_PRESETS, type WritingMeasure } from "@/lib/writing-projects";

// Mirrors the same fallback convention used in app/(member)/dashboard/page.tsx,
// app/(member)/writing/actions.ts, and app/(member)/streaks/page.tsx.
export const ORG_TIMEZONE = "America/New_York";

const BATCH_SIZE = 1000;

async function fetchAllPaginated<T>(
  queryFn: (offset: number) => PromiseLike<{ data: T[] | null }>
): Promise<T[]> {
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

export interface PrickleGoalCandidate {
  memberId: string;
  goalId: string;
  projectId: string;
  /** All three null means "any writing prickle" -- the member's own explicit choice, not a gap to infer around. */
  anchorTypeId: string | null;
  anchorHostId: string | null;
  anchorDayOfWeek: number | null;
}

/**
 * Every member's active (non-archived project, non-archived goal) measure='prickles' goal --
 * the single consent gate for both the pre-prickle nudge and the post-prickle prompt (see Phase 1
 * plan's Context section for why one shared gate instead of two).
 */
export async function getActivePrickleGoalCandidates(supabase: any): Promise<PrickleGoalCandidate[]> {
  const { data } = await supabase
    .from("writing_goals")
    .select("id, member_id, project_id, anchor_type_id, anchor_host_id, anchor_day_of_week, writing_projects!inner(archived_at)")
    .eq("measure", "prickles")
    .is("archived_at", null)
    .is("writing_projects.archived_at", null);

  return ((data ?? []) as any[]).map((g) => ({
    memberId: g.member_id,
    goalId: g.id,
    projectId: g.project_id,
    anchorTypeId: g.anchor_type_id,
    anchorHostId: g.anchor_host_id,
    anchorDayOfWeek: g.anchor_day_of_week,
  }));
}

/** 0=Sunday..6=Saturday in the given IANA timezone -- matches prickle_schedules.day_of_week / JS Date.getDay() convention. */
export function localDayOfWeek(isoTimestamp: string, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).formatToParts(
    new Date(isoTimestamp)
  );
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
}

export interface UpcomingPrickle {
  id: string;
  typeId: string;
  hostId: string | null;
  startTime: string;
  typeName: string;
}

/**
 * Whether an upcoming prickle satisfies a prickles-measure goal's anchor. Each set anchor field
 * applies independently; all three null ("any writing prickle") matches everything -- mirrors
 * derivePrickleHabitEntries' own matching semantics (lib/writing-projects.ts) so targeting here
 * agrees with what the goal will actually count once attendance is imported.
 */
export function prickleMatchesAnchor(
  prickle: { typeId: string; hostId: string | null; startTime: string },
  anchor: { typeId: string | null; hostId: string | null; dayOfWeek: number | null },
  timeZone: string = ORG_TIMEZONE
): boolean {
  if (anchor.typeId != null && prickle.typeId !== anchor.typeId) return false;
  if (anchor.hostId != null && prickle.hostId !== anchor.hostId) return false;
  if (anchor.dayOfWeek != null && localDayOfWeek(prickle.startTime, timeZone) !== anchor.dayOfWeek) return false;
  return true;
}

/** Full slackUserId -> memberId map, same 3-tier matching (alias > email > normalized name) Wheel of Wonder uses. */
async function buildSlackUserIdToMemberIdMap(supabase: any): Promise<Map<string, string>> {
  const [allMembersResult, aliases, slackUsersResult] = await Promise.all([
    supabase.from("members").select("id, name, email"),
    fetchAllPaginated<{ member_id: string; alias: string; source: "zoom" | "slack" }>((offset) =>
      supabase.from("member_name_aliases").select("member_id, alias, source").range(offset, offset + BATCH_SIZE - 1)
    ),
    supabase.schema("bronze").from("slack_users").select("user_id, email, real_name"),
  ]);

  return matchSlackUsersToMembers(slackUsersResult.data ?? [], allMembersResult.data ?? [], aliases);
}

/** memberId -> slackUserId, for a specific set of members. */
export async function resolveSlackUserIds(supabase: any, memberIds: string[]): Promise<Map<string, string>> {
  const slackUserIdByMember = new Map<string, string>();
  if (memberIds.length === 0) return slackUserIdByMember;

  const memberIdSet = new Set(memberIds);
  const slackUserToMemberId = await buildSlackUserIdToMemberIdMap(supabase);
  for (const [slackUserId, memberId] of slackUserToMemberId) {
    if (memberIdSet.has(memberId)) slackUserIdByMember.set(memberId, slackUserId);
  }
  return slackUserIdByMember;
}

/** Reverse lookup for an inbound Slack interaction: the Slack user id we're handed, resolved to a member id. */
export async function resolveMemberIdForSlackUser(supabase: any, slackUserId: string): Promise<string | null> {
  const map = await buildSlackUserIdToMemberIdMap(supabase);
  return map.get(slackUserId) ?? null;
}

export type NudgeKind = "pre_prickle_nudge" | "post_prickle_prompt";

/**
 * Insert-attempt with ON CONFLICT DO NOTHING against writing_nudge_log's unique
 * (prickle_id, member_id, kind) constraint -- returns true only if this call's insert actually
 * landed a row, i.e. this is the first time this exact DM would go out for this pair. Callers
 * must only send the Slack message when this returns true.
 */
export async function tryRecordNudge(
  supabase: any,
  prickleId: string,
  memberId: string,
  kind: NudgeKind
): Promise<boolean> {
  const { data, error } = await supabase
    .from("writing_nudge_log")
    .insert({ prickle_id: prickleId, member_id: memberId, kind })
    .select("id");

  if (error) {
    // Unique violation means another tick (or the other sender) already recorded this pair --
    // not a real error, just "don't send."
    if (error.code === "23505") return false;
    console.error(`tryRecordNudge failed for prickle=${prickleId} member=${memberId} kind=${kind}:`, error);
    return false;
  }
  return (data?.length ?? 0) > 0;
}

/**
 * Which measure the post-prickle quick-log DM should ask about for this project. 'prickles'
 * itself is never a candidate -- it's computed live from attendance, nothing to quick-log (see
 * MEASURE_QUICK_LOG_PRESETS). If the member has logged entries in exactly one other measure on
 * this project, ask about that one; otherwise default to time_minutes, the fastest to estimate
 * right after a session and the universal fallback.
 */
async function pickQuickLogMeasure(supabase: any, projectId: string, memberId: string): Promise<WritingMeasure> {
  const { data } = await supabase
    .from("writing_progress_entries")
    .select("measure")
    .eq("project_id", projectId)
    .eq("member_id", memberId);

  const distinct = [...new Set(((data ?? []) as any[]).map((e) => e.measure as WritingMeasure))];
  return distinct.length === 1 ? distinct[0] : "time_minutes";
}

/**
 * Phase 1, item 10: post-prickle quick-log prompt. Called after a prickle's attendance has been
 * imported (see app/api/webhooks/zoom/route.ts's meeting.ended branch, which only calls this
 * once triggerZoomImport resolves). Sends attendees with an active prickles-measure goal a
 * one-tap inline dropdown -- not the prickles measure itself (already automatic), but the output
 * (words/minutes/pages/etc.) attendance tracking can't capture. Returns the number of DMs sent.
 */
export async function sendPostPricklePrompts(supabase: any, prickleId: string): Promise<number> {
  const { data: prickleRow } = await supabase
    .from("prickles")
    .select("id, prickle_types(name)")
    .eq("id", prickleId)
    .single();
  const type = Array.isArray(prickleRow?.prickle_types) ? prickleRow?.prickle_types[0] : prickleRow?.prickle_types;
  const typeName = type?.name ?? "that prickle";

  const { data: attendanceRows } = await supabase.from("prickle_attendance").select("member_id").eq("prickle_id", prickleId);
  const attendeeIds = [...new Set(((attendanceRows ?? []) as any[]).map((r) => r.member_id as string))];
  if (attendeeIds.length === 0) return 0;

  const candidates = await getActivePrickleGoalCandidates(supabase);
  const eligible = candidates.filter((c) => attendeeIds.includes(c.memberId));
  if (eligible.length === 0) return 0;

  const slackUserIdByMember = await resolveSlackUserIds(supabase, eligible.map((c) => c.memberId));

  let sent = 0;
  for (const candidate of eligible) {
    const slackUserId = slackUserIdByMember.get(candidate.memberId);
    if (!slackUserId) continue;

    const shouldSend = await tryRecordNudge(supabase, prickleId, candidate.memberId, "post_prickle_prompt");
    if (!shouldSend) continue;

    const measure = await pickQuickLogMeasure(supabase, candidate.projectId, candidate.memberId);
    const presets = MEASURE_QUICK_LOG_PRESETS[measure]!;

    await sendSlackDM({
      slackUserId,
      text: `How much did you write during ${typeName}?`,
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: `How much did you write during *${typeName}*?` },
          accessory: {
            type: "static_select",
            action_id: "writing_quick_log",
            placeholder: { type: "plain_text", text: "Pick an amount" },
            options: presets.map((p) => ({
              text: { type: "plain_text", text: p.label },
              value: `${candidate.projectId}:${prickleId}:${measure}:${p.amount}`,
            })),
          },
        },
      ],
    });
    sent++;
  }
  return sent;
}
