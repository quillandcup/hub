import {
  PROGRESS_QUESTION_MEASURES,
  progressMeasureFor,
  progressQuestion,
  type WritingMeasure,
} from "@/lib/writing-projects";
import { loadCalendarFeedPrickleIds } from "@/lib/calendar-feed";
import { APP_URL } from "@/lib/config";
import { createNotifier } from "@/lib/notifications/notify";
import { resolveInAppNotifications } from "@/lib/channels/in-app";
import type { OutboundMessage } from "@/lib/channels";
import { loadPresenceByMember, presenceDue, type PresenceInterval } from "@/lib/zoom-presence";
import {
  checkinAnswered,
  checkinFromRow,
  checkinHref,
  checkoutAnswered,
  FEELINGS,
  isEmptyCheckin,
  MAX_FEELINGS,
  NEEDS,
  SESSION_RATINGS,
  validateCheckin,
  writeCheckin,
  type CheckinInput,
  type Feeling,
  type Need,
} from "@/lib/prickle-checkins";

/**
 * Prickle check-in and check-out DMs: Slack's way into the same check-in as the prickle page
 * (lib/prickle-checkins.ts, prickle_checkins). ~20 min before a prickle on their calendar, a
 * member with an active writing goal gets a check-in DM (how they're feeling coming in, what they
 * need); after it, each such attendee gets a check-out DM (how it went, how they feel now, plus a
 * progress quick-log per goal). Each answer saves straight into their check-in.
 */

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
 * measure -- the consent gate for both the check-in and the check-out DM. A member who is
 * tracking words, chapters, scenes etc. wants them as much as one counting prickles; the measure
 * only decides what the check-out's progress quick-log asks about.
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
 * (lib/calendar-feed.ts), so "check in with them if it's on their calendar" can't drift from what
 * the calendar shows. A member whose calendar fails to load is logged and gets no check-ins this tick.
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
 * Which (member, prickle) pairs get a check-in DM: a member with any active goal, for each
 * upcoming prickle on their calendar (hosting, commitments, added by hand). Nothing else -- a
 * prickle they haven't put on their calendar never triggers a DM. Exactly one entry per member
 * per prickle, however many goals they have.
 */
export function planCheckinDMs<P extends UpcomingPrickle>(
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

export type CheckinDMKind = "prickle_checkin" | "prickle_checkout";

/**
 * Insert-attempt with ON CONFLICT DO NOTHING against prickle_checkin_dm_log's unique
 * (prickle_id, member_id, kind) constraint -- returns true only if this call's insert actually
 * landed a row, i.e. this is the first time this exact DM would go out for this pair. Callers
 * must only send the Slack message when this returns true.
 */
export async function tryRecordCheckinDM(
  supabase: any,
  prickleId: string,
  memberId: string,
  kind: CheckinDMKind
): Promise<boolean> {
  const { data, error } = await supabase
    .from("prickle_checkin_dm_log")
    .insert({ prickle_id: prickleId, member_id: memberId, kind })
    .select("id");

  if (error) {
    // Unique violation means another tick (or the other sender) already recorded this pair --
    // not a real error, just "don't send."
    if (error.code === "23505") return false;
    console.error(`tryRecordCheckinDM failed for prickle=${prickleId} member=${memberId} kind=${kind}:`, error);
    return false;
  }
  return (data?.length ?? 0) > 0;
}

/** Measures this member has logged on the project, most recent first (a recency hint, so only the latest entries are read). */
async function recentMeasures(supabase: any, projectId: string, memberId: string): Promise<WritingMeasure[]> {
  const { data } = await supabase
    .from("writing_progress_entries")
    .select("measure")
    .eq("project_id", projectId)
    .eq("member_id", memberId)
    .order("created_at", { ascending: false })
    .limit(50);
  return [...new Set(((data ?? []) as any[]).map((e) => e.measure as WritingMeasure))];
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

/** One project + measure to ask about in a check-out DM. */
export interface QuickLogPrompt {
  projectId: string;
  projectTitle: string;
  measure: WritingMeasure;
}

/**
 * The check-out DM's progress questions: a fill-in-the-blank number per project, worded for its
 * measure ("How many words did you write on X during Y?"), answered by typing a number and
 * pressing Enter (an input block with dispatch_action, so the answer arrives as a block_actions
 * payload). Each block's id is unique and carries the prickle and project, so the interaction
 * handler logs the right entry and replaces just the answered one.
 */
export function buildQuickLogBlocks(prickleTitle: string, prickleId: string, prompts: QuickLogPrompt[]): any[] {
  return prompts.map((prompt) => ({
    type: "input",
    block_id: `quick_log:${prickleId}:${prompt.projectId}:${prompt.measure}`,
    dispatch_action: true,
    optional: true,
    label: plain(progressQuestion(prompt.measure, prompt.projectTitle, prickleTitle)),
    element: {
      type: "number_input",
      action_id: QUICK_LOG_ACTION_ID,
      is_decimal_allowed: false,
      min_value: "0",
      placeholder: plain("Type a number, press Enter"),
      dispatch_action_config: { trigger_actions_on: ["on_enter_pressed"] },
    },
  }));
}

export interface QuickLogAnswer {
  prickleId: string;
  projectId: string;
  measure: WritingMeasure;
  amount: number;
}

/**
 * Reads a progress answer out of a Slack block_actions action; null if it isn't a valid one. Also
 * reads the one-tap dropdown older DMs still in people's Slack carry (value
 * `project:prickle:measure:amount`).
 */
export function parseQuickLogAnswer(action: any): QuickLogAnswer | null {
  if (action?.action_id !== QUICK_LOG_ACTION_ID) return null;
  let prickleId: string | undefined;
  let projectId: string | undefined;
  let measure: string | undefined;
  let amountRaw: unknown;
  if (action.selected_option) {
    [projectId, prickleId, measure, amountRaw] = String(action.selected_option.value ?? "").split(":");
  } else {
    [, prickleId, projectId, measure] = String(action.block_id ?? "").split(":");
    amountRaw = action.value;
  }
  const amount = typeof amountRaw === "string" && amountRaw.trim() !== "" ? Number(amountRaw) : NaN;
  if (!prickleId || !projectId || !(PROGRESS_QUESTION_MEASURES as string[]).includes(measure ?? "")) return null;
  if (!Number.isFinite(amount) || amount < 0) return null;
  return { prickleId, projectId, measure: measure as WritingMeasure, amount };
}

// --- Check-in questions ----------------------------------------------------------------------

export const CHECKIN_ANSWER_ACTION_ID = "prickle_checkin_answer";

/** The check-in answers a DM can ask, by prickle_checkins column. */
export type CheckinField = "feelings_before" | "need" | "session_rating" | "feelings_after";

const CHECKIN_FIELDS: readonly CheckinField[] = ["feelings_before", "need", "session_rating", "feelings_after"];

/** block_id for a check-in question: the prickle rides along so the answer knows where to save. */
const checkinBlockId = (prickleId: string, field: CheckinField) => `prickle_checkin:${prickleId}:${field}`;

const plain = (text: string) => ({ type: "plain_text", text });

type SlackOption = { text: { type: string; text: string }; value: string };

const FEELING_OPTIONS: SlackOption[] = FEELINGS.map((f) => ({ text: plain(f.label), value: f.key }));
const NEED_OPTIONS: SlackOption[] = NEEDS.map((n) => ({ text: plain(`${n.label} · ${n.hint}`), value: n.key }));

/** Each field's Slack options, so a saved answer can be shown as the select's initial value. */
/** Select fields only: the rating is a row of star buttons (ratingBlocks), not a select. */
const FIELD_OPTIONS: Partial<Record<CheckinField, SlackOption[]>> = {
  feelings_before: FEELING_OPTIONS,
  need: NEED_OPTIONS,
  feelings_after: FEELING_OPTIONS,
};

const isMultiField = (field: CheckinField) => field === "feelings_before" || field === "feelings_after";

/** The saved answer for `field` as option values; unanswered is []. */
function savedValues(checkin: CheckinInput | null, field: CheckinField): string[] {
  if (!checkin) return [];
  switch (field) {
    case "feelings_before":
      return checkin.feelingsBefore;
    case "feelings_after":
      return checkin.feelingsAfter;
    case "need":
      return checkin.need ? [checkin.need] : [];
    case "session_rating":
      return checkin.sessionRating === null ? [] : [String(checkin.sessionRating)];
  }
}

/**
 * A select with its initial value set to `values`. Slack keeps a pick on screen only until the
 * message is next updated (e.g. by a quick-log answer), so each answer is written back into the
 * blocks this way.
 */
function withInitial(accessory: any, field: CheckinField, values: string[]): any {
  const rest = { ...accessory };
  delete rest.initial_option;
  delete rest.initial_options;
  const selected = (FIELD_OPTIONS[field] ?? []).filter((o) => values.includes(o.value));
  if (selected.length === 0) return rest;
  return isMultiField(field) ? { ...rest, initial_options: selected } : { ...rest, initial_option: selected[0] };
}

function checkinQuestion(prickleId: string, field: CheckinField, question: string, saved: CheckinInput | null): any {
  const accessory = isMultiField(field)
    ? {
        type: "multi_static_select",
        action_id: CHECKIN_ANSWER_ACTION_ID,
        placeholder: plain(`Pick up to ${MAX_FEELINGS}`),
        max_selected_items: MAX_FEELINGS,
        options: FIELD_OPTIONS[field],
      }
    : {
        type: "static_select",
        action_id: CHECKIN_ANSWER_ACTION_ID,
        placeholder: plain("Pick one"),
        options: FIELD_OPTIONS[field],
      };
  return {
    type: "section",
    block_id: checkinBlockId(prickleId, field),
    text: { type: "mrkdwn", text: question },
    accessory: withInitial(accessory, field, savedValues(saved, field)),
  };
}

/**
 * "How did it go?" as five star buttons side by side (Slack has no rating element): the question,
 * then one row of buttons, the saved rating's button highlighted. Each button's value is its
 * rating; the row's block_id is the usual check-in one so the answer saves like any other.
 */
function ratingBlocks(prickleId: string, question: string, saved: CheckinInput | null): any[] {
  return [
    { type: "section", text: { type: "mrkdwn", text: question } },
    {
      type: "actions",
      block_id: checkinBlockId(prickleId, "session_rating"),
      elements: SESSION_RATINGS.map((r) => ({
        type: "button",
        action_id: `${CHECKIN_ANSWER_ACTION_ID}:${r.value}`,
        text: plain("★".repeat(r.value)),
        value: String(r.value),
        ...(saved?.sessionRating === r.value ? { style: "primary" } : {}),
      })),
    },
  ];
}

function checkinFooter(prickleId: string, kind: "checkin" | "checkout" = "checkin"): any {
  return {
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `Optional. Answers save to your <${APP_URL}${checkinHref(prickleId, kind)}|${kind === "checkout" ? "check-out" : "check-in"} for this prickle>, which only you and the admins can see.`,
      },
    ],
  };
}

// Shared with the web check-in/check-out (lib/prickle-checkins.ts), so "answered" means the
// same thing in Slack and on the site.
export { checkinAnswered, checkoutAnswered };

/** The check-in DM, before a prickle: how they're feeling coming in and what they need. */
export function buildCheckinBlocks(prickleId: string, typeName: string, saved: CheckinInput | null): any[] {
  return [
    checkinQuestion(prickleId, "feelings_before", `*${typeName}* starts in about 20 minutes. How are you feeling coming in?`, saved),
    checkinQuestion(prickleId, "need", "What do you need from this session?", saved),
    checkinFooter(prickleId),
  ];
}

/** The check-out DM, after a prickle: how it went, how they feel now, then the progress quick-log. */
export function buildCheckoutBlocks(
  prickleId: string,
  typeName: string,
  saved: CheckinInput | null,
  prompts: QuickLogPrompt[],
  prickleTitle: string = typeName
): any[] {
  return [
    ...ratingBlocks(prickleId, `Checking out of *${typeName}*: how did it go?`, saved),
    checkinQuestion(prickleId, "feelings_after", "How are you feeling now?", saved),
    ...buildQuickLogBlocks(prickleTitle, prickleId, prompts),
    checkinFooter(prickleId, "checkout"),
  ];
}

export interface CheckinAnswer {
  prickleId: string;
  field: CheckinField;
  /** Selected option values: up to MAX_FEELINGS for feelings (none when cleared), one otherwise. */
  values: string[];
}

/** Reads a check-in answer out of a Slack block_actions action; null if it isn't one. */
export function parseCheckinAnswer(action: any): CheckinAnswer | null {
  // Selects use the bare action id; each rating star button appends its value (action ids are unique per block).
  if (action?.action_id !== CHECKIN_ANSWER_ACTION_ID && !String(action?.action_id).startsWith(`${CHECKIN_ANSWER_ACTION_ID}:`)) {
    return null;
  }
  const [prefix, prickleId, field] = String(action.block_id ?? "").split(":");
  if (prefix !== "prickle_checkin" || !prickleId || !(CHECKIN_FIELDS as readonly string[]).includes(field)) return null;
  let values: string[] = [];
  if (Array.isArray(action.selected_options)) values = action.selected_options.map((o: any) => String(o?.value));
  else if (action.selected_option) values = [String(action.selected_option.value)];
  else if (action.type === "button" && action.value !== undefined) values = [String(action.value)];
  return { prickleId, field: field as CheckinField, values };
}

/** `checkin` with one answer replaced. Unknown keys are left for validateCheckin to reject. */
export function applyCheckinAnswer(checkin: CheckinInput, field: CheckinField, values: string[]): CheckinInput {
  switch (field) {
    case "feelings_before":
      return { ...checkin, feelingsBefore: values as Feeling[] };
    case "feelings_after":
      return { ...checkin, feelingsAfter: values as Feeling[] };
    case "need":
      return { ...checkin, need: (values[0] ?? null) as Need | null };
    case "session_rating":
      return { ...checkin, sessionRating: values[0] === undefined ? null : Number(values[0]) };
  }
}

/** After an answer, the DM's blocks with that question showing what was saved. */
export function withSavedAnswer(blocks: any[] | undefined, answer: CheckinAnswer): any[] | undefined {
  if (!Array.isArray(blocks)) return blocks;
  const blockId = checkinBlockId(answer.prickleId, answer.field);
  return blocks.map((b) => {
    if (b.block_id !== blockId) return b;
    if (b.accessory) return { ...b, accessory: withInitial(b.accessory, answer.field, answer.values) };
    // The star row: highlight the picked button only.
    if (Array.isArray(b.elements)) {
      return {
        ...b,
        elements: b.elements.map((el: any) => {
          const { style: _style, ...rest } = el;
          return el.value === answer.values[0] ? { ...rest, style: "primary" } : rest;
        }),
      };
    }
    return b;
  });
}

const EMPTY_CHECKIN: CheckinInput = { feelingsBefore: [], need: null, sessionRating: null, feelingsAfter: [] };

/** Saved check-ins for these members and prickles, keyed `${memberId}:${prickleId}`. */
export async function loadCheckins(
  supabase: any,
  memberIds: string[],
  prickleIds: string[]
): Promise<Map<string, CheckinInput>> {
  const result = new Map<string, CheckinInput>();
  if (memberIds.length === 0 || prickleIds.length === 0) return result;
  const rows = await fetchAllPaginated<any>((offset) =>
    supabase
      .from("prickle_checkins")
      .select("id, member_id, prickle_id, feelings_before, need, session_rating, feelings_after")
      .in("member_id", memberIds)
      .in("prickle_id", prickleIds)
      .is("deleted_at", null)
      .order("id")
      .range(offset, offset + BATCH_SIZE - 1)
  );
  for (const row of rows) result.set(`${row.member_id}:${row.prickle_id}`, checkinFromRow(row));
  return result;
}

/**
 * Saves one answer from a DM into the member's check-in, the same row the prickle page edits:
 * merged with what's there, validated like the page's saveCheckin, and soft-deleted when
 * clearing it leaves nothing (writeCheckin). A service-role write, so the caller must already have matched the Slack user to
 * `memberId`. Returns an error message, or null when saved.
 */
export async function saveCheckinAnswer(supabase: any, memberId: string, answer: CheckinAnswer): Promise<string | null> {
  const { prickleId, field, values } = answer;
  const { data: existing, error: readError } = await supabase
    .from("prickle_checkins")
    .select("feelings_before, need, session_rating, feelings_after")
    .eq("member_id", memberId)
    .eq("prickle_id", prickleId)
    .is("deleted_at", null)
    .maybeSingle();
  if (readError) return `couldn't read check-in: ${readError.message}`;

  const next = applyCheckinAnswer(existing ? checkinFromRow(existing) : EMPTY_CHECKIN, field, values);
  const invalid = validateCheckin(next);
  if (invalid) return invalid;
  if (isEmptyCheckin(next) && !existing) return null;

  const error = await writeCheckin(supabase, memberId, prickleId, next);
  if (error) return `couldn't save check-in: ${error.message}`;
  await resolveAnsweredCheckinNotifications(supabase, memberId, prickleId, next);
  return null;
}

/**
 * Resolves the in-app check-in/check-out notifications a saved check-in has now answered, wherever
 * it was answered (prickle page, Log Progress, Slack), so they don't keep asking: the banner goes
 * and the bell stops counting them.
 */
export async function resolveAnsweredCheckinNotifications(
  supabase: any,
  memberId: string,
  prickleId: string,
  checkin: CheckinInput
): Promise<void> {
  await Promise.all([
    checkinAnswered(checkin) ? resolveInAppNotifications(supabase, memberId, "prickle_checkin", prickleId) : null,
    checkoutAnswered(checkin) ? resolveInAppNotifications(supabase, memberId, "prickle_checkout", prickleId) : null,
  ]);
}

// --- Check-out sender ------------------------------------------------------------------------

/**
 * How long after a prickle ends a check-out can still go out. Live presence (the Zoom participant
 * webhooks) normally triggers it within minutes; the fallback is attendance, which only arrives
 * once the whole Zoom meeting ends (up to ~3 hours later when one room runs several prickles back
 * to back). Anything imported later (e.g. by the nightly reconcile) is too stale to ask "how did
 * it go?" about.
 */
export const CHECKOUT_LOOKBACK_MS = 6 * 60 * 60 * 1000;

/** How far before a prickle's start to read presence events: a member can join a room hours early. */
const PRESENCE_LOOKBEHIND_MS = 12 * 60 * 60 * 1000;

/** A started writing prickle, from the last CHECKOUT_LOOKBACK_MS, that may be due a check-out. */
export interface RecentPrickle {
  id: string;
  typeName: string;
  /** How the prickle is named in a question, e.g. "Monday Progress Prickle with Jenn P" (see formatPrickleTitle); the type name when unknown. */
  title?: string;
  startTime: string;
  endTime: string;
}

/**
 * prickleId -> members due a check-out, from two sources:
 * - Live presence (Zoom participant webhooks): in a Zoom meeting during the prickle -- any
 *   meeting from a host the attendance import covers, since those run one at a time (1
 *   overlapping pair in 417 meetings over 60 days, checked 2026-10-03; see docs/TODO.md,
 *   "Secondary Zoom rooms") -- and either it
 *   ended 5 minutes ago (so a room running prickles back to back doesn't hold them up) or they
 *   left more than 10 minutes ago without rejoining (an early leaver). See presenceDue.
 * - Attendance: imported once their Zoom meeting ends, so its existence means the session is
 *   over for them. The backstop for any lost or late webhook.
 */
export function dueCheckoutMembers(
  prickles: RecentPrickle[],
  attendeesByPrickle: Map<string, Set<string>>,
  presenceByMember: Map<string, PresenceInterval[]>,
  now: number
): Map<string, Set<string>> {
  const due = new Map<string, Set<string>>();
  for (const prickle of prickles) {
    const members = new Set(attendeesByPrickle.get(prickle.id) ?? []);
    const start = new Date(prickle.startTime).getTime();
    const end = new Date(prickle.endTime).getTime();
    for (const [memberId, intervals] of presenceByMember) {
      if (presenceDue(intervals, start, end, now)) members.add(memberId);
    }
    if (members.size > 0) due.set(prickle.id, members);
  }
  return due;
}

/**
 * Which (member, prickle) pairs get a check-out now: members due one (dueCheckoutMembers) with
 * any active goal, minus pairs already sent one. Exactly one entry per member per prickle, however
 * many attendance rows (leave/rejoin), devices or goals they have.
 */
export function planCheckoutDMs<P extends RecentPrickle>(
  prickles: P[],
  dueByPrickle: Map<string, Set<string>>,
  candidates: GoalCandidate[],
  alreadySent: Set<string>
): { memberId: string; prickle: P }[] {
  const withGoals = new Set(candidates.map((c) => c.memberId));
  const plan: { memberId: string; prickle: P }[] = [];
  for (const prickle of prickles) {
    for (const memberId of dueByPrickle.get(prickle.id) ?? []) {
      if (withGoals.has(memberId) && !alreadySent.has(`${memberId}:${prickle.id}`)) plan.push({ memberId, prickle });
    }
  }
  return plan;
}

/** prickleId -> member ids with attendance for it. */
async function loadAttendees(supabase: any, prickleIds: string[]): Promise<Map<string, Set<string>>> {
  const rows = await fetchAllPaginated<any>((offset) =>
    supabase
      .from("prickle_attendance")
      .select("id, member_id, prickle_id")
      .in("prickle_id", prickleIds)
      .order("id")
      .range(offset, offset + BATCH_SIZE - 1)
  );
  const result = new Map<string, Set<string>>();
  for (const r of rows) {
    const set = result.get(r.prickle_id) ?? new Set<string>();
    set.add(r.member_id);
    result.set(r.prickle_id, set);
  }
  return result;
}

/** `${memberId}:${prickleId}` for every check-out already sent for these prickles. */
async function loadSentCheckouts(supabase: any, prickleIds: string[]): Promise<Set<string>> {
  const rows = await fetchAllPaginated<any>((offset) =>
    supabase
      .from("prickle_checkin_dm_log")
      .select("id, member_id, prickle_id")
      .eq("kind", "prickle_checkout")
      .in("prickle_id", prickleIds)
      .order("id")
      .range(offset, offset + BATCH_SIZE - 1)
  );
  return new Set(rows.map((r) => `${r.member_id}:${r.prickle_id}`));
}

/** `${memberId}:${prickleId}:${projectId}` for every project already logged against these prickles. */
async function loadLoggedProjects(supabase: any, memberIds: string[], prickleIds: string[]): Promise<Set<string>> {
  const rows = await fetchAllPaginated<any>((offset) =>
    supabase
      .from("writing_progress_entries")
      .select("id, member_id, prickle_id, project_id")
      .in("prickle_id", prickleIds)
      .in("member_id", memberIds)
      .order("id")
      .range(offset, offset + BATCH_SIZE - 1)
  );
  return new Set(rows.map((r) => `${r.member_id}:${r.prickle_id}:${r.project_id}`));
}

/**
 * Check-out DMs, run from the same 5-minute cron as the check-ins
 * (app/api/internal/prickle-checkins/route.ts) over `prickles`: started writing prickles from the
 * last CHECKOUT_LOOKBACK_MS. Each member due one (dueCheckoutMembers) with any active writing
 * goal gets one DM: how it went,
 * how they feel now, and a progress dropdown per goal in that goal's measure (words, chapters,
 * scenes...) -- or, for a prickles goal, the output attendance tracking can't capture. A project
 * they've already logged progress against for this prickle gets no dropdown, and with both
 * questions answered too, no DM. Returns the number of DMs sent.
 */
export async function sendCheckoutDMs(
  supabase: any,
  prickles: RecentPrickle[],
  candidates: GoalCandidate[],
  now: number
): Promise<number> {
  if (prickles.length === 0 || candidates.length === 0) return 0;
  const prickleIds = prickles.map((p) => p.id);
  const earliestStart = Math.min(...prickles.map((p) => new Date(p.startTime).getTime()));
  const presenceSince = Number.isFinite(earliestStart)
    ? earliestStart - PRESENCE_LOOKBEHIND_MS
    : now - CHECKOUT_LOOKBACK_MS - PRESENCE_LOOKBEHIND_MS;
  const [attendeesByPrickle, alreadySent, presenceByMember] = await Promise.all([
    loadAttendees(supabase, prickleIds),
    loadSentCheckouts(supabase, prickleIds),
    loadPresenceByMember(supabase, new Date(presenceSince), new Date(now)),
  ]);
  const dueByPrickle = dueCheckoutMembers(prickles, attendeesByPrickle, presenceByMember, now);
  const plan = planCheckoutDMs(prickles, dueByPrickle, candidates, alreadySent);
  if (plan.length === 0) return 0;

  const memberIds = [...new Set(plan.map((p) => p.memberId))];
  const plannedPrickleIds = [...new Set(plan.map((p) => p.prickle.id))];
  const [notifier, checkins, loggedProjects] = await Promise.all([
    createNotifier(supabase, "prickle_checkout", memberIds),
    loadCheckins(supabase, memberIds, plannedPrickleIds),
    loadLoggedProjects(supabase, memberIds, plannedPrickleIds),
  ]);
  const goalsByMember = groupByMember(candidates);

  let sent = 0;
  for (const { memberId, prickle } of plan) {
    // Opted out on every channel, or unreachable on the ones they kept. Not logged, so turning
    // check-outs back on (or linking Slack) before the lookback ends still sends one.
    if (!notifier.canReach(memberId)) continue;

    // Not logged when skipped, so a later tick still sends if they clear an answer.
    const saved = checkins.get(`${memberId}:${prickle.id}`) ?? null;
    const unlogged = (goalsByMember.get(memberId) ?? []).filter(
      (g) => !loggedProjects.has(`${memberId}:${prickle.id}:${g.projectId}`)
    );
    if (checkoutAnswered(saved) && unlogged.length === 0) continue;

    const shouldSend = await tryRecordCheckinDM(supabase, prickle.id, memberId, "prickle_checkout");
    if (!shouldSend) continue;

    const delivered = await notifier.send(
      memberId,
      checkoutMessage(prickle, saved, await quickLogPrompts(supabase, unlogged))
    );
    if (delivered.length > 0) sent++;
  }
  return sent;
}

/**
 * The check-out DM's progress prompts for these goals: one question per project, in the measure
 * its goals track (or, for a prickles-only goal, what they last logged, else minutes), the same
 * rule the web check-out follows (progressMeasureFor).
 */
async function quickLogPrompts(supabase: any, goals: GoalCandidate[]): Promise<QuickLogPrompt[]> {
  const byProject = new Map<string, { goal: GoalCandidate; measures: WritingMeasure[] }>();
  for (const goal of goals) {
    const entry = byProject.get(goal.projectId) ?? { goal, measures: [] };
    entry.measures.push(goal.measure);
    byProject.set(goal.projectId, entry);
  }
  const prompts: QuickLogPrompt[] = [];
  for (const { goal, measures } of byProject.values()) {
    const measure = progressMeasureFor(measures, await recentMeasures(supabase, goal.projectId, goal.memberId));
    prompts.push({ projectId: goal.projectId, projectTitle: goal.projectTitle, measure });
  }
  return prompts;
}

/**
 * A DM's prickle: enough to word the message and link the check-in. The times, when known, set
 * how long it's time-sensitive (in-app: a banner, then only in the bell and inbox):
 * - Check-in: until the prickle starts (its text says "in ~20 min"; the prickle page still takes
 *   one after).
 * - Check-out: for CHECKOUT_TIME_SENSITIVE_MS after the prickle ends (one sent later, e.g. from
 *   the attendance backstop, goes straight to the bell).
 */
type DMPrickle = { id: string; typeName: string; title?: string; startTime?: string; endTime?: string };

export const CHECKOUT_TIME_SENSITIVE_MS = 3 * 60 * 60 * 1000;

function offsetIso(time: string | undefined, ms: number): string | undefined {
  return time ? new Date(Date.parse(time) + ms).toISOString() : undefined;
}

/** First block of a test send, so it isn't mistaken for the real thing. */
const TEST_BANNER = {
  type: "context",
  elements: [
    { type: "mrkdwn", text: "🧪 Test send from the admin prickle page. Answers still save to your check-in for this prickle." },
  ],
};

/** The check-in DM. Sending it is the caller's call: no dedup or skip checks here. */
export function checkinMessage(prickle: DMPrickle, saved: CheckinInput | null, { test = false } = {}): OutboundMessage {
  const blocks = buildCheckinBlocks(prickle.id, prickle.typeName, saved);
  return {
    text: `${test ? "[Test] " : ""}Ready for ${prickle.typeName} in ~20 min? Check in: how are you feeling coming in?`,
    url: `${APP_URL}${checkinHref(prickle.id, "checkin")}`,
    slackBlocks: test ? [TEST_BANNER, ...blocks] : blocks,
    ref: prickle.id,
    timeSensitiveUntil: offsetIso(prickle.startTime, 0),
  };
}

/** The check-out DM. Sending it is the caller's call: no dedup or skip checks here. */
export function checkoutMessage(
  prickle: DMPrickle,
  saved: CheckinInput | null,
  prompts: QuickLogPrompt[],
  { test = false } = {}
): OutboundMessage {
  const blocks = buildCheckoutBlocks(prickle.id, prickle.typeName, saved, prompts, prickle.title ?? prickle.typeName);
  return {
    text: `${test ? "[Test] " : ""}Checking out of ${prickle.typeName}: how did it go?`,
    url: `${APP_URL}${checkinHref(prickle.id, "checkout")}`,
    slackBlocks: test ? [TEST_BANNER, ...blocks] : blocks,
    ref: prickle.id,
    timeSensitiveUntil: offsetIso(prickle.endTime, CHECKOUT_TIME_SENSITIVE_MS),
  };
}

/**
 * Sends `memberId` a test check-in or check-out DM for `prickle`, worded as the cron would but
 * skipping everything that decides whether one is due: their calendar, attendance/presence, the
 * dedup log (nothing is logged, so it can't block the real one) and the already-answered checks.
 * It still shows their saved answers, and the check-out asks about every active goal (none, with
 * no goals). Always over Slack, whatever their notification settings: they just asked for it.
 * Returns an error message, or null when sent.
 */
export async function sendTestCheckinDM(
  supabase: any,
  memberId: string,
  prickle: DMPrickle,
  kind: CheckinDMKind
): Promise<string | null> {
  const notifier = await createNotifier(supabase, kind, [memberId], { channels: ["slack"] });
  if (!notifier.canReach(memberId)) return "No Slack account is matched to your member record.";

  const saved = (await loadCheckins(supabase, [memberId], [prickle.id])).get(`${memberId}:${prickle.id}`) ?? null;
  let message: OutboundMessage;
  if (kind === "prickle_checkin") {
    message = checkinMessage(prickle, saved, { test: true });
  } else {
    const goals = (await getActiveGoalCandidates(supabase)).filter((g) => g.memberId === memberId);
    message = checkoutMessage(prickle, saved, await quickLogPrompts(supabase, goals), { test: true });
  }
  const delivered = await notifier.send(memberId, message);
  return delivered.length > 0 ? null : "Slack didn't accept the message; check the server logs.";
}
