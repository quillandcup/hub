/**
 * Hedgie Care: the community manager's reach-outs to members (docs/HEDGIE_CARE.md). Plain module (no server
 * imports), so the page and its client components share the status rule and the measured windows (the value sets are in
 * lib/care-values.ts). An **engagement** is one reach-out period with one member; its status is derived here from its
 * dates and who spoke last, never stored.
 */
import {
  CARE_AFTER_FROM_DAYS,
  CARE_AFTER_TO_DAYS,
  CARE_BEFORE_DAYS,
  CARE_ENGAGEMENT_DAYS,
  CARE_LAPSE_GRACE_DAYS,
  CARE_QUIET_DAYS,
  CARE_RETENTION_CHECKPOINT_DAYS,
  ORG_TIMEZONE,
} from "@/lib/config";
import { addDays, orgYmd, type Ymd } from "@/lib/org-week";
import { zonedTimeToUtc } from "@/lib/prickle-schedules";

// The value sets, labels and guards live in lib/care-values.ts (no imports); re-exported so callers can take everything from here.
export * from "@/lib/care-values";

/** The settings the status and the period follow from (app.config.ts); tests pass their own. */
export type CareSettings = { engagementDays: number; lapseGraceDays: number; quietDays: number };

export const CARE_SETTINGS: CareSettings = {
  engagementDays: CARE_ENGAGEMENT_DAYS,
  lapseGraceDays: CARE_LAPSE_GRACE_DAYS,
  quietDays: CARE_QUIET_DAYS,
};

/**
 * The last day of an engagement that opens at `openedAt`: the org-timezone calendar day `engagementDays` days after
 * the one it opened on. The period runs through the whole of that day. Calendar arithmetic, not 24-hour steps, so a
 * daylight saving change or an evening opening (late in the day in Eastern time, already tomorrow in UTC) can't move it.
 */
export function periodEndsOn(openedAt: Date, engagementDays: number = CARE_ENGAGEMENT_DAYS): Ymd {
  return addDays(orgYmd(openedAt), engagementDays);
}

/** A real calendar day written as "YYYY-MM-DD" (not "2026-02-30"). */
export function isRealDay(value: unknown): value is Ymd {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Why a chosen start day can't be used: `invalid` (not a real day) or `future` (after today, an Eastern calendar day). A
 * period is only started or moved to a day that has begun; null when the day is fine.
 */
export function startDayProblem(startedOn: unknown, now: Date): "invalid" | "future" | null {
  if (!isRealDay(startedOn)) return "invalid";
  return startedOn > orgYmd(now) ? "future" : null;
}

/**
 * The instant a care plan that started on `startedOn` (an Eastern calendar day, not in the future) is recorded as opened:
 * `now` when that day is today, else **noon Eastern** of that day. She enters a conversation by its day, not its time, and
 * noon is a time that exists on every day (a clock change happens at 2 a.m.), sits well inside the day (so the Eastern day it
 * lands on is never in doubt), and is where the Slack DM derivation, which counts messages from the start of that day,
 * begins to look.
 */
export function careStartInstant(startedOn: Ymd, now: Date): Date {
  return startedOn >= orgYmd(now) ? now : zonedTimeToUtc(startedOn, "12:00", ORG_TIMEZONE);
}

/** The start of an Eastern calendar day, as an instant (midnight; the 23- and 25-hour days still begin at midnight). */
export function startOfOrgDay(ymd: Ymd): Date {
  return zonedTimeToUtc(ymd, "00:00", ORG_TIMEZONE);
}

/**
 * When the first message of a care plan started on `startedOn` is recorded: now for today, else the **start of that Eastern
 * day**. The opening instant is noon for a past day, but the first message is only a placeholder for "somebody wrote that
 * day": putting it at midnight means a real DM from that morning, which counts from the start of the day, can still replace
 * it (a time only moves forward), instead of being hidden behind a made-up noon.
 */
export function careFirstMessageInstant(startedOn: Ymd, now: Date): Date {
  return startedOn >= orgYmd(now) ? now : startOfOrgDay(startedOn);
}

/** Whole calendar days from one day to a later one (pure date arithmetic: no clock change can add or remove an hour). */
export function daysBetween(from: Ymd, to: Ymd): number {
  const utc = (ymd: Ymd) => {
    const [y, m, d] = ymd.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utc(to) - utc(from)) / MS_PER_DAY);
}

/**
 * The last day of a period whose start moves to `newOpenedAt`: the new Eastern day plus the length the period had (from the
 * Eastern day it opened on to its last day), not the length now in the settings. A period that ran 30 days still runs 30, even
 * if `careEngagementDays` has changed since; and she can't end up with a period that ends before it began.
 */
export function shiftedPeriodEnd(current: Pick<CareTimes, "opened_at" | "period_ends_on">, newOpenedAt: Date): Ymd {
  const length = Math.max(0, daysBetween(orgYmd(new Date(current.opened_at)), current.period_ends_on));
  return addDays(orgYmd(newOpenedAt), length);
}

/** What surrounds a care plan's start in its chain: when the one it continues started, when its renewal started, when it was closed. */
export type StartAround = { previousOpenedAt: string | null; renewalOpenedAt: string | null; closedAt: string | null };

/**
 * A chosen start that lands on the same Eastern day as the one before or the one after it in the chain, but on the wrong
 * side of it by the hour (noon against a morning start), is moved to that boundary: the day is allowed, the time of day is
 * whatever keeps the order. Any other start is returned as it is.
 */
export function clampToChain(next: Date, around: StartAround): Date {
  const day = orgYmd(next);
  const after = around.previousOpenedAt ? new Date(around.previousOpenedAt) : null;
  const before = [around.renewalOpenedAt, around.closedAt].filter((t): t is string => !!t).map((t) => new Date(t)).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
  if (after && next.getTime() < after.getTime() && orgYmd(after) === day) return after;
  if (before && next.getTime() > before.getTime() && orgYmd(before) === day) return before;
  return next;
}

/** Why a period's start can't move to a day: it would start before the period it continues, after its renewal, or after it was closed. */
export type StartChangeRefusal = "before_previous" | "after_renewal" | "after_closed";

/**
 * Moving a start must keep the chain in order: not before the start of the period it continues (`renewed_from`), not after
 * the start of the period that continued it, and not after it was closed. `null` when the start may move. Instants are
 * compared as they are, so the same day is fine.
 */
export function startChangeRefusal(
  newOpenedAt: Date,
  around: StartAround
): { reason: StartChangeRefusal; limit: string } | null {
  const at = newOpenedAt.getTime();
  if (around.previousOpenedAt && at < Date.parse(around.previousOpenedAt)) return { reason: "before_previous", limit: around.previousOpenedAt };
  if (around.renewalOpenedAt && at > Date.parse(around.renewalOpenedAt)) return { reason: "after_renewal", limit: around.renewalOpenedAt };
  if (around.closedAt && at > Date.parse(around.closedAt)) return { reason: "after_closed", limit: around.closedAt };
  return null;
}

/** What an engagement's status follows from. */
export type CareTimes = {
  closed_at: string | null;
  /** The last day of the period (a plain date in the org timezone). */
  period_ends_on: string;
  opened_at: string;
  last_staff_message_at: string | null;
  last_member_message_at: string | null;
};

/**
 * What an engagement needs from her. Derived, never stored; no job moves anything:
 * - `closed`: she closed it (or renewed it);
 * - `needs_reply`: the member wrote last. This wins over everything while it is open, **however old the period**: a
 *   member who wrote is never quietly dropped, it stays here until she replies, renews or closes it;
 * - `lapsed`: the period ended more than `lapseGraceDays` days ago and nobody has dealt with it. Shown under Earlier,
 *   not counted as active;
 * - `review_due`: the period has ended, and it is still inside the grace window: renew it or close it;
 * - `gone_quiet`: nothing from either side for more than `quietDays` days;
 * - `waiting`: she wrote last (or opened it) and the quiet window has not passed.
 * Days are org-timezone calendar days (the period is a date); the quiet window compares instants.
 */
export type CareStatus = "needs_reply" | "review_due" | "waiting" | "gone_quiet" | "lapsed" | "closed";

export const CARE_STATUS_LABELS: Record<CareStatus, string> = {
  needs_reply: "Needs your reply",
  review_due: "Review due",
  waiting: "Waiting on them",
  gone_quiet: "Gone quiet",
  lapsed: "Lapsed",
  closed: "Closed",
};

const MS_PER_DAY = 86_400_000;

/** The latest moment either side wrote, or when it was opened if nobody has been logged yet. */
export function lastActivityAt(c: Pick<CareTimes, "opened_at" | "last_staff_message_at" | "last_member_message_at">): string {
  return [c.opened_at, c.last_staff_message_at, c.last_member_message_at].filter((t): t is string => !!t).reduce((a, b) => (b > a ? b : a));
}

/** Whether the member wrote after the last time she did (or she has not written at all). */
export function memberWroteLast(c: Pick<CareTimes, "last_staff_message_at" | "last_member_message_at">): boolean {
  const member = c.last_member_message_at ? Date.parse(c.last_member_message_at) : null;
  const staff = c.last_staff_message_at ? Date.parse(c.last_staff_message_at) : null;
  return member !== null && (staff === null || member > staff);
}

export function careStatus(c: CareTimes, now: Date, settings: CareSettings = CARE_SETTINGS): CareStatus {
  if (c.closed_at) return "closed";
  if (memberWroteLast(c)) return "needs_reply";
  const today = orgYmd(now);
  if (today > addDays(c.period_ends_on, settings.lapseGraceDays)) return "lapsed";
  if (today > c.period_ends_on) return "review_due";
  return now.getTime() - Date.parse(lastActivityAt(c)) > settings.quietDays * MS_PER_DAY ? "gone_quiet" : "waiting";
}

/** The ones on the Active tab: open and not lapsed. */
export function isActiveStatus(status: CareStatus): boolean {
  return status !== "closed" && status !== "lapsed";
}

/** The order the Active tab shows: what needs her first, who she is only waiting on last. */
const ACTIVE_RANK: Record<CareStatus, number> = { needs_reply: 0, review_due: 1, gone_quiet: 2, waiting: 3, lapsed: 4, closed: 5 };

/** The day an ended engagement ended, for ordering Earlier: when it was closed, or the last day of a lapsed period. */
function endedDay(c: Pick<CareTimes, "closed_at" | "period_ends_on">): string {
  return c.closed_at ? orgYmd(new Date(c.closed_at)) : c.period_ends_on;
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The Active tab's order: by status, then the one waiting longest first (an overdue period by its end date), then id. */
export function sortActive<T extends CareTimes & { id: string }>(rows: readonly T[], now: Date, settings: CareSettings = CARE_SETTINGS): T[] {
  return rows
    .map((row) => ({ row, status: careStatus(row, now, settings) }))
    .sort((a, b) => {
      if (a.status !== b.status) return ACTIVE_RANK[a.status] - ACTIVE_RANK[b.status];
      const x = a.status === "review_due" ? a.row.period_ends_on : lastActivityAt(a.row);
      const y = b.status === "review_due" ? b.row.period_ends_on : lastActivityAt(b.row);
      if (x !== y) return x < y ? -1 : 1;
      return byId(a.row, b.row);
    })
    .map(({ row }) => row);
}

/** The Earlier tab's order: the ones that ended most recently first (closed and lapsed together), then id. */
export function sortEarlier<T extends CareTimes & { id: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const x = endedDay(a);
    const y = endedDay(b);
    if (x !== y) return x < y ? 1 : -1;
    return byId(a, b);
  });
}

/** Whether a follow-up date (a plain day) has come: today or earlier in the organization's timezone. */
export function isFollowUpDue(followUpOn: string | null, now: Date): boolean {
  return followUpOn !== null && followUpOn <= orgYmd(now);
}

/** Whole days from `iso` to `now`, never negative. */
export function daysSince(iso: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / MS_PER_DAY));
}

/** "today", "yesterday" or "5 days ago": how long ago an instant was, for the list. */
export function daysAgoLabel(iso: string, now: Date): string {
  const days = daysSince(iso, now);
  return days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
}

// ---------------------------------------------------------------------------------------------
// Measured results: three windows around an engagement, counted from the member's own activity.
// ---------------------------------------------------------------------------------------------

export type CareWindowName = "before" | "during" | "after";

/** How far the window has got: `complete`, `so_far` (still running: counted up to now) or `not_yet` (not counted). */
export type CareWindowState = "complete" | "so_far" | "not_yet";

export type CareWindow = {
  name: CareWindowName;
  /** The window is [from, to): ISO instants. */
  from: string;
  to: string;
  state: CareWindowState;
};

/** The settings the windows follow from (app.config.ts). */
export type CareWindowSettings = { beforeDays: number; afterFromDays: number; afterToDays: number };

export const CARE_WINDOW_SETTINGS: CareWindowSettings = {
  beforeDays: CARE_BEFORE_DAYS,
  afterFromDays: CARE_AFTER_FROM_DAYS,
  afterToDays: CARE_AFTER_TO_DAYS,
};

/** The start of the day after `ymd` in the organization's timezone: the instant a period ending on `ymd` is over. */
export function endOfOrgDay(ymd: Ymd): Date {
  return zonedTimeToUtc(addDays(ymd, 1), "00:00", ORG_TIMEZONE);
}

/**
 * The three windows an engagement is measured in:
 * - **before**: the `beforeDays` days before it opened (exact 24-hour days);
 * - **during**: from when it opened to the end of its period, or when she closed it if that was sooner (a renewal
 *   closes the old period when the new one starts). While it is still running it is counted up to now (`so_far`);
 * - **after**: from `afterFromDays` to `afterToDays` days after the period's last day, by calendar day in the
 *   organization's timezone. Until that has fully passed it is `not_yet`: a half-finished window would read as a
 *   result it is not.
 */
export function careWindows(
  engagement: Pick<CareTimes, "opened_at" | "closed_at" | "period_ends_on">,
  now: Date,
  settings: CareWindowSettings = CARE_WINDOW_SETTINGS
): Record<CareWindowName, CareWindow> {
  const opened = Date.parse(engagement.opened_at);
  const periodEnd = endOfOrgDay(engagement.period_ends_on).getTime();
  const duringEnd = Math.min(periodEnd, engagement.closed_at ? Date.parse(engagement.closed_at) : Infinity);
  const afterFrom = zonedTimeToUtc(addDays(engagement.period_ends_on, 1 + settings.afterFromDays), "00:00", ORG_TIMEZONE).getTime();
  const afterTo = zonedTimeToUtc(addDays(engagement.period_ends_on, 1 + settings.afterToDays), "00:00", ORG_TIMEZONE).getTime();
  const nowMs = now.getTime();
  const iso = (ms: number) => new Date(ms).toISOString();
  return {
    before: { name: "before", from: iso(opened - settings.beforeDays * MS_PER_DAY), to: iso(opened), state: "complete" },
    during: {
      name: "during",
      from: iso(opened),
      to: iso(Math.min(duringEnd, Math.max(nowMs, opened))),
      state: duringEnd <= nowMs ? "complete" : "so_far",
    },
    after: { name: "after", from: iso(afterFrom), to: iso(afterTo), state: afterTo <= nowMs ? "complete" : "not_yet" },
  };
}

/** Whether they were active, on hiatus or cancelled at a moment: derived from membership history; a member on hiatus has not left (and is not counted as having stayed either). */
export type CareMembership = "member" | "on_hiatus" | "not_a_member";

export const CARE_MEMBERSHIP_LABELS: Record<CareMembership, string> = {
  member: "Active",
  on_hiatus: "On hiatus",
  not_a_member: "Cancelled",
};

/** What was counted in one window. `counts` is null where the window is `not_yet`. */
export type CareWindowResult = {
  window: CareWindow;
  counts: {
    /** Distinct prickles attended (not attendance records: leaving and rejoining one is one prickle). */
    pricklesAttended: number;
    /** Slack messages and thread replies. */
    slackMessages: number;
    /** Their first prickle ever / first Slack post ever fell in this window. */
    firstPrickle: boolean;
    firstSlackPost: boolean;
    /** Distinct members they interacted with (DMs, thread replies, mentions, reactions), not counting staff. */
    peopleConnected: number;
    /** The programs whose cohort started inside the window, each with its own length ("Example Program, 6 months"). */
    programsStarted: string[];
  } | null;
};

/**
 * One checkpoint of the graded retention view: `days` after the period's last day, whether they were active, on hiatus or
 * cancelled then. Three distinct states, never a single weighted number (any weighting for a cohort view is config).
 * `membership` and `programs` are null while the checkpoint is `not_yet`.
 */
export type CareCheckpoint = {
  days: number;
  /** The instant: the start of the Eastern day `days` days after the period's last day. */
  at: string;
  state: "complete" | "not_yet";
  membership: CareMembership | null;
  /** The programs they were enrolled in at that moment, each with its length (the commitment held), or none. */
  programs: string[] | null;
};

/** The first time, after the engagement opened, that they went on hiatus or left, even if they came back. */
export type CareFirstLapse = { status: "on_hiatus" | "cancelled"; at: string; daysAfterStart: number };

export type CareRetention = {
  checkpoints: CareCheckpoint[];
  /** Null when they have not gone on hiatus or left since it opened. */
  firstLapse: CareFirstLapse | null;
};

export type CareResults = { windows: Record<CareWindowName, CareWindowResult>; retention: CareRetention };

/** The checkpoint instants and whether each has passed: `days` after the period's last day, by Eastern calendar day. */
export function careCheckpoints(
  engagement: Pick<CareTimes, "period_ends_on">,
  now: Date,
  days: readonly number[] = CARE_RETENTION_CHECKPOINT_DAYS
): { days: number; at: Date; state: "complete" | "not_yet" }[] {
  return [...days]
    .sort((a, b) => a - b)
    .map((n) => {
      const at = zonedTimeToUtc(addDays(engagement.period_ends_on, 1 + n), "00:00", ORG_TIMEZONE);
      return { days: n, at, state: at.getTime() <= now.getTime() ? ("complete" as const) : ("not_yet" as const) };
    });
}

/** How long a program (a cohort's own start and end dates) is, for the commitment it was: "6 months" from 60 days on, else days. */
export function commitmentLength(startsAt: string, expiresAt: string): string {
  const days = Math.max(0, Math.round((Date.parse(expiresAt) - Date.parse(startsAt)) / MS_PER_DAY));
  if (days < 60) return `${days} day${days === 1 ? "" : "s"}`;
  const months = Math.round(days / 30.4);
  return `${months} months`;
}

/** "first", "second", "third"...: the ordinal a care plan in a chain of renewals is called by (staff read "second plan", never "Period 2"). */
export function planOrdinal(n: number): string {
  const words = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
  if (n >= 1 && n <= words.length) return words[n - 1];
  const rule = new Intl.PluralRules("en", { type: "ordinal" }).select(n);
  return `${n}${rule === "one" ? "st" : rule === "two" ? "nd" : rule === "few" ? "rd" : "th"}`;
}

/**
 * Which period of a chain of renewals this engagement is (the first is 1): one more than the number of engagements it was
 * renewed from, followed through `renewed_from` among the rows given. An ancestor that was removed or is not among the rows
 * ends the count there. Guards against a cycle.
 */
export function periodNumber(row: { id: string; renewed_from: string | null }, byId: ReadonlyMap<string, { renewed_from: string | null }>): number {
  let n = 1;
  const seen = new Set([row.id]);
  let next = row.renewed_from;
  while (next && !seen.has(next) && byId.has(next)) {
    seen.add(next);
    n += 1;
    next = byId.get(next)!.renewed_from;
  }
  return n;
}
