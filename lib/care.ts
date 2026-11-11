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

/** Whether they were a member at the end of a window: derived from membership history, a member on hiatus is not gone. */
export type CareMembership = "member" | "on_hiatus" | "not_a_member";

export const CARE_MEMBERSHIP_LABELS: Record<CareMembership, string> = {
  member: "Member",
  on_hiatus: "On hiatus",
  not_a_member: "Not a member",
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
    /** Their membership at the end of the window (the end so far for one still running), from the membership history. */
    membershipAtEnd: CareMembership;
    /** The programs they were enrolled in from a start date inside the window (names). */
    programsStarted: string[];
  } | null;
};

export type CareResults = Record<CareWindowName, CareWindowResult>;

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
