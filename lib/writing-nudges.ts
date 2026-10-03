import { matchSlackUsersToMembers } from "@/lib/slack-matching";
import { sendSlackDM } from "@/lib/slack";
import { MEASURE_QUICK_LOG_PRESETS, type WritingMeasure } from "@/lib/writing-projects";
import { loadCalendarFeedPrickleIds } from "@/lib/calendar-feed";

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

export interface GoalCandidate {
  memberId: string;
  goalId: string;
  projectId: string;
  projectTitle: string;
  measure: WritingMeasure;
}

/**
 * Every member's active (non-archived project, non-archived goal) writing goal, whatever its
 * measure -- the consent gate for both the pre-prickle nudge and the post-prickle prompt. A
 * member who is tracking words, chapters, scenes etc. wants the prompts as much as one counting
 * prickles; the measure only decides what the post-prickle prompt asks about.
 */
export async function getActiveGoalCandidates(supabase: any): Promise<GoalCandidate[]> {
  const rows = await fetchAllPaginated<any>((offset) =>
    supabase
      .from("writing_goals")
      .select(
        "id, member_id, project_id, measure, writing_projects!inner(title, archived_at)"
      )
      .is("archived_at", null)
      .is("writing_projects.archived_at", null)
      .order("id")
      .range(offset, offset + BATCH_SIZE - 1)
  );

  return rows.map((g) => {
    const project = Array.isArray(g.writing_projects) ? g.writing_projects[0] : g.writing_projects;
    return {
      memberId: g.member_id,
      goalId: g.id,
      projectId: g.project_id,
      projectTitle: project?.title ?? "your project",
      measure: g.measure as WritingMeasure,
    };
  });
}

/** Candidates grouped by member, in first-seen order. */
export function groupByMember<T extends { memberId: string }>(candidates: T[]): Map<string, T[]> {
  const byMember = new Map<string, T[]>();
  for (const c of candidates) {
    const list = byMember.get(c.memberId);
    if (list) list.push(c);
    else byMember.set(c.memberId, [c]);
  }
  return byMember;
}

/** Members whose calendars load at once -- each is a handful of queries. */
const CALENDAR_LOAD_CONCURRENCY = 10;

/**
 * memberId -> ids of the prickles on that member's calendar feed from `since` on: hosting,
 * commitments and prickles added by hand. It's the same loader the .ics feed uses
 * (lib/calendar-feed.ts), so "nudge them if it's on their calendar" can't drift from what the
 * calendar shows. A member whose calendar fails to load is logged and gets no nudges this tick.
 */
export async function loadCalendarPrickleIdsByMember(
  supabase: any,
  memberIds: string[],
  since: Date,
  now: Date = new Date()
): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>();
  for (let i = 0; i < memberIds.length; i += CALENDAR_LOAD_CONCURRENCY) {
    await Promise.all(
      memberIds.slice(i, i + CALENDAR_LOAD_CONCURRENCY).map(async (memberId) => {
        try {
          result.set(memberId, await loadCalendarFeedPrickleIds(supabase, memberId, since, now));
        } catch (error) {
          console.error(`loadCalendarPrickleIdsByMember: calendar failed to load for member=${memberId}:`, error);
          result.set(memberId, new Set());
        }
      })
    );
  }
  return result;
}

export interface UpcomingPrickle {
  id: string;
  typeId: string;
  hostId: string | null;
  startTime: string;
  typeName: string;
}

/**
 * Which (member, prickle) pairs get a pre-prickle nudge: a member with any active goal, for each
 * upcoming prickle on their calendar (hosting, commitments, added by hand). Nothing else -- a
 * prickle they haven't put on their calendar never triggers a DM. Exactly one entry per member
 * per prickle, however many goals they have.
 */
export function planPrePrickleNudges<P extends UpcomingPrickle>(
  candidates: GoalCandidate[],
  upcomingPrickles: P[],
  calendarPrickleIdsByMember: Map<string, Set<string>>
): { memberId: string; prickle: P }[] {
  const plan: { memberId: string; prickle: P }[] = [];
  for (const memberId of new Set(candidates.map((c) => c.memberId))) {
    const onCalendar = calendarPrickleIdsByMember.get(memberId);
    if (!onCalendar) continue;
    for (const prickle of upcomingPrickles) {
      if (onCalendar.has(prickle.id)) plan.push({ memberId, prickle });
    }
  }
  return plan;
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


/** The measure a goal's quick-log prompt asks about: its own, unless it's 'prickles' (counted automatically from attendance). */
async function quickLogMeasureFor(supabase: any, goal: GoalCandidate): Promise<WritingMeasure> {
  if (MEASURE_QUICK_LOG_PRESETS[goal.measure]) return goal.measure;
  return pickQuickLogMeasure(supabase, goal.projectId, goal.memberId);
}

export const QUICK_LOG_ACTION_ID = "writing_quick_log";

/**
 * After a quick-log answer: swap just the answered dropdown for its confirmation so the DM's
 * other dropdowns stay answerable. With no blocks to work from (an older single-dropdown DM),
 * the whole message becomes the confirmation.
 */
export function replaceAnsweredBlock(blocks: any[] | undefined, blockId: string | undefined, confirmation: string): any[] {
  const confirmationBlock = { type: "section", text: { type: "mrkdwn", text: confirmation } };
  if (!Array.isArray(blocks) || !blockId || !blocks.some((b) => b.block_id === blockId)) return [confirmationBlock];
  return blocks.map((b) => (b.block_id === blockId ? confirmationBlock : b));
}

/** One project + measure to ask about in a post-prickle prompt. */
export interface QuickLogPrompt {
  projectId: string;
  projectTitle: string;
  measure: WritingMeasure;
}

/**
 * Slack blocks for one post-prickle DM: a dropdown per project + measure. Each section's block_id
 * is unique so the interaction handler can replace just the answered one and leave the rest.
 */
export function buildQuickLogBlocks(typeName: string, prickleId: string, prompts: QuickLogPrompt[]): any[] {
  return prompts.map((prompt) => {
    const presets = MEASURE_QUICK_LOG_PRESETS[prompt.measure]!;
    const question =
      prompts.length === 1
        ? `How much did you write during *${typeName}*?`
        : `How much did you get done on *${prompt.projectTitle}* during *${typeName}*?`;
    return {
      type: "section",
      block_id: `quick_log:${prompt.projectId}:${prompt.measure}`,
      text: { type: "mrkdwn", text: question },
      accessory: {
        type: "static_select",
        action_id: QUICK_LOG_ACTION_ID,
        placeholder: { type: "plain_text", text: "Pick an amount" },
        options: presets.map((p) => ({
          text: { type: "plain_text", text: p.label },
          value: `${prompt.projectId}:${prickleId}:${prompt.measure}:${p.amount}`,
        })),
      },
    };
  });
}

/**
 * Phase 1, item 10: post-prickle quick-log prompt. Called after a prickle's attendance has been
 * imported (see app/api/webhooks/zoom/route.ts's meeting.ended branch, which only calls this
 * once triggerZoomImport resolves). Sends each attendee with any active writing goal one DM with
 * an inline dropdown per goal, asking in that goal's measure (words, chapters, scenes...) -- or,
 * for a prickles goal, the output attendance tracking can't capture. Returns the number of DMs sent.
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
  const attendeeIds = new Set(((attendanceRows ?? []) as any[]).map((r) => r.member_id as string));
  if (attendeeIds.size === 0) return 0;

  const candidates = await getActiveGoalCandidates(supabase);
  const goalsByMember = groupByMember(candidates.filter((c) => attendeeIds.has(c.memberId)));
  if (goalsByMember.size === 0) return 0;

  const slackUserIdByMember = await resolveSlackUserIds(supabase, [...goalsByMember.keys()]);

  let sent = 0;
  for (const [memberId, goals] of goalsByMember) {
    const slackUserId = slackUserIdByMember.get(memberId);
    if (!slackUserId) continue;

    const shouldSend = await tryRecordNudge(supabase, prickleId, memberId, "post_prickle_prompt");
    if (!shouldSend) continue;

    // Two goals on one project in the same measure would be the same question -- ask it once.
    const prompts = new Map<string, QuickLogPrompt>();
    for (const goal of goals) {
      const measure = await quickLogMeasureFor(supabase, goal);
      prompts.set(`${goal.projectId}:${measure}`, { projectId: goal.projectId, projectTitle: goal.projectTitle, measure });
    }

    await sendSlackDM({
      slackUserId,
      text: `How much did you write during ${typeName}?`,
      blocks: buildQuickLogBlocks(typeName, prickleId, [...prompts.values()]),
    });
    sent++;
  }
  return sent;
}
