// Builds the three admin "work queue" lists described in
// docs — Welcome Back, Hedgieversary Celebrations, Hiatus Nudges — from
// already-fetched member/hiatus rows plus the set of occurrences an admin
// has already marked done (admin_work_queue_completions). Pure functions,
// no I/O, so they're independently testable; the page (page.tsx) does the
// fetching and calls these.
import {
  computeCumulativeHiatusMonths,
  hedgieversaryMilestonesInWindow,
  milestoneLabel,
  type HiatusWindow,
} from "./member-tenure";
import { computeAllHiatusTouchpoints } from "./hiatus-touchpoints";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

// How far into the future a deadline can be and still show up (lets an
// admin see what's coming and prep content), and how far into the past a
// not-yet-completed deadline can be and still show up (bounds the backlog —
// without this, launching the feature would flood the queue with every
// historical milestone/touchpoint/hiatus-end that predates completion
// tracking). Kept short (vs. the 90-day "recent" convention used elsewhere,
// e.g. the Welcome Back badge) since this is just a bootstrap window for
// items that were already due when the feature launched — steady-state
// items get plenty of runway from the lookahead side instead.
export const WORK_QUEUE_LOOKAHEAD_DAYS = 14;
export const WORK_QUEUE_LOOKBACK_DAYS = 14;

export type WorkQueueType = "welcome_back" | "hedgieversary" | "hiatus_nudge";

export interface WorkQueueItem {
  queueType: WorkQueueType;
  memberId: string;
  memberName: string;
  occurrenceKey: string;
  deadline: string; // date-only
  label: string;
  // Hiatus Nudge only: the hiatus's known end_date (null = indefinite
  // hiatus). Left undefined for the other two queue types.
  expectedReturnDate?: string | null;
}

// Per-occurrence outcome recorded in admin_work_queue_completions.
// 'opted_out'/'postponed' only ever apply to 'hedgieversary' occurrences
// (enforced by the POST route) — 'welcome_back'/'hiatus_nudge' only ever
// use 'completed'.
export type CompletionStatus = "completed" | "opted_out" | "postponed";

export interface CompletionInfo {
  status: CompletionStatus;
  postponedUntil: string | null; // date-only, required when status is 'postponed'
}

// Keyed by completionKey(queueType, memberId, occurrenceKey).
export type CompletionLookup = Map<string, CompletionInfo>;

// 'completed'/'opted_out' suppress an occurrence forever. 'postponed'
// suppresses it only until postponedUntil, at which point it resurfaces —
// this is what lets a postponed Hedgieversary celebration come back into
// the queue instead of vanishing for good.
function isSuppressed(completions: CompletionLookup, key: string, nowMs: number): boolean {
  const info = completions.get(key);
  if (!info) return false;
  if (info.status === "postponed") {
    if (!info.postponedUntil) return true; // malformed row — fail closed (stay suppressed)
    return nowMs < new Date(`${info.postponedUntil}T00:00:00Z`).getTime();
  }
  return true; // 'completed' or 'opted_out'
}

export interface MemberInput {
  id: string;
  name: string;
  first_joined_at: string | null;
}

export interface HiatusInput {
  id: string;
  member_id: string;
  start_date: string;
  end_date: string | null;
}

export function completionKey(queueType: WorkQueueType, memberId: string, occurrenceKey: string): string {
  return `${queueType}:${memberId}:${occurrenceKey}`;
}

function inWindow(deadlineMs: number, nowMs: number, lookaheadDays: number, lookbackDays: number): boolean {
  return deadlineMs >= nowMs - lookbackDays * MS_PER_DAY && deadlineMs <= nowMs + lookaheadDays * MS_PER_DAY;
}

function byDeadline(a: WorkQueueItem, b: WorkQueueItem): number {
  return a.deadline.localeCompare(b.deadline);
}

// Queue 1: a hiatus with a known end date that has passed (or is about to) —
// time to re-enable Slack/Kajabi access. Indefinite hiatuses (no end_date)
// never appear — there's no return date to act on.
export function buildWelcomeBackQueue(
  hiatusRows: HiatusInput[],
  membersById: Map<string, { name: string }>,
  completed: CompletionLookup,
  now: Date,
  lookaheadDays: number = WORK_QUEUE_LOOKAHEAD_DAYS,
  lookbackDays: number = WORK_QUEUE_LOOKBACK_DAYS
): WorkQueueItem[] {
  const nowMs = now.getTime();
  const items: WorkQueueItem[] = [];

  for (const hiatus of hiatusRows) {
    if (!hiatus.end_date) continue;
    const member = membersById.get(hiatus.member_id);
    if (!member) continue;

    const deadlineMs = new Date(`${hiatus.end_date}T00:00:00Z`).getTime();
    if (!inWindow(deadlineMs, nowMs, lookaheadDays, lookbackDays)) continue;
    if (isSuppressed(completed, completionKey("welcome_back", hiatus.member_id, hiatus.id), nowMs)) continue;

    items.push({
      queueType: "welcome_back",
      memberId: hiatus.member_id,
      memberName: member.name,
      occurrenceKey: hiatus.id,
      deadline: hiatus.end_date,
      label: "Hiatus ended",
    });
  }

  return items.sort(byDeadline);
}

// Queue 2: every Hedgieversary milestone reached (or due soon) that hasn't
// been celebrated yet. occurrenceKey is the milestone month count — each
// milestone happens once per member, ever, so it never collides across a
// member's history even if hiatus edits later shift the exact date.
export function buildHedgieversaryQueue(
  members: MemberInput[],
  hiatusWindowsByMember: Map<string, HiatusWindow[]>,
  completed: CompletionLookup,
  now: Date,
  lookaheadDays: number = WORK_QUEUE_LOOKAHEAD_DAYS,
  lookbackDays: number = WORK_QUEUE_LOOKBACK_DAYS
): WorkQueueItem[] {
  const nowMs = now.getTime();
  const items: WorkQueueItem[] = [];

  for (const member of members) {
    if (!member.first_joined_at) continue;

    const windows = hiatusWindowsByMember.get(member.id) ?? [];
    const cumulativeHiatusMonths = computeCumulativeHiatusMonths(windows, now);
    const isOnIndefiniteHiatus = windows.some(
      (w) => !w.endsAt && new Date(w.startsAt).getTime() <= nowMs
    );

    const milestones = hedgieversaryMilestonesInWindow(
      member.first_joined_at,
      cumulativeHiatusMonths,
      isOnIndefiniteHiatus,
      now,
      lookaheadDays
    );

    for (const milestone of milestones) {
      const deadlineMs = new Date(`${milestone.date}T00:00:00Z`).getTime();
      if (!inWindow(deadlineMs, nowMs, lookaheadDays, lookbackDays)) continue;

      const occurrenceKey = String(milestone.milestoneMonths);
      if (isSuppressed(completed, completionKey("hedgieversary", member.id, occurrenceKey), nowMs)) continue;

      items.push({
        queueType: "hedgieversary",
        memberId: member.id,
        memberName: member.name,
        occurrenceKey,
        deadline: milestone.date,
        label: milestoneLabel(milestone.milestoneMonths),
      });
    }
  }

  return items.sort(byDeadline);
}

// Queue 3: the 25/50/75% check-in marks for every known-duration hiatus.
// occurrenceKey combines the hiatus id and the percent, since each hiatus
// period has its own independent set of three marks.
export function buildHiatusNudgeQueue(
  hiatusRows: HiatusInput[],
  membersById: Map<string, { name: string }>,
  completed: CompletionLookup,
  now: Date,
  lookaheadDays: number = WORK_QUEUE_LOOKAHEAD_DAYS,
  lookbackDays: number = WORK_QUEUE_LOOKBACK_DAYS
): WorkQueueItem[] {
  const nowMs = now.getTime();
  const items: WorkQueueItem[] = [];

  for (const hiatus of hiatusRows) {
    const member = membersById.get(hiatus.member_id);
    if (!member) continue;

    const marks = computeAllHiatusTouchpoints(hiatus.start_date, hiatus.end_date);
    for (const mark of marks) {
      const deadlineMs = new Date(mark.date).getTime();
      if (!inWindow(deadlineMs, nowMs, lookaheadDays, lookbackDays)) continue;

      const occurrenceKey = `${hiatus.id}:${mark.pct}`;
      if (isSuppressed(completed, completionKey("hiatus_nudge", hiatus.member_id, occurrenceKey), nowMs)) continue;

      items.push({
        queueType: "hiatus_nudge",
        memberId: hiatus.member_id,
        memberName: member.name,
        occurrenceKey,
        deadline: mark.date.slice(0, 10),
        label: `${mark.pct}% mark`,
        expectedReturnDate: hiatus.end_date,
      });
    }
  }

  return items.sort(byDeadline);
}
