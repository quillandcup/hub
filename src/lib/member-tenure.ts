import { detectResubscriptions } from "@/lib/resubscription-detection";
import type { MembershipPurchase } from "@/lib/kajabi/membership-history";

const MS_PER_DAY = 1000 * 60 * 60 * 24;
// A lapse in coverage shorter than this is a handoff (program to membership), not a return.
const MIN_RETURN_GAP_DAYS = 2;

// A hiatus window from member_status_overrides (override_type='hiatus').
// endsAt null means the hiatus is still ongoing (open-ended or a planned
// end date that hasn't arrived yet).
export interface HiatusWindow {
  startsAt: string;
  endsAt: string | null;
}

function toDateOnly(iso: string): string {
  return iso.split("T")[0];
}

// Parses a "YYYY-MM-DD" date-only string (as stored in first_joined_at /
// most_recent_joined_at / nextHedgieversaryDate's nextDate) for display.
// `new Date("2023-02-15")` alone parses as UTC midnight, which renders as
// the *previous* day once .toLocaleDateString() converts to a timezone
// behind UTC (e.g. America/New_York) — this parses as local midnight
// instead, so the displayed date always matches the stored date.
export function parseDateOnly(dateOnly: string): Date {
  return new Date(`${dateOnly}T00:00:00`);
}

// Days in [start, end) minus any time that overlaps a hiatus window.
// Ongoing hiatus windows (endsAt null) are treated as open until `asOf`.
export function computeActiveDays(
  start: string,
  end: string,
  hiatusWindows: HiatusWindow[],
  asOf: Date
): number {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (endMs <= startMs) return 0;

  let hiatusMs = 0;
  for (const window of hiatusWindows) {
    const windowStartMs = new Date(window.startsAt).getTime();
    const windowEndMs = window.endsAt ? new Date(window.endsAt).getTime() : asOf.getTime();
    const overlapStart = Math.max(startMs, windowStartMs);
    const overlapEnd = Math.min(endMs, windowEndMs);
    if (overlapEnd > overlapStart) hiatusMs += overlapEnd - overlapStart;
  }

  return Math.max(0, (endMs - startMs - hiatusMs) / MS_PER_DAY);
}

export interface MemberTenure {
  firstJoinedAt: string | null;
  mostRecentJoinedAt: string | null;
  totalActiveMonths: number;
}

// Computes a member's tenure from their membership stints (see
// buildMembershipStints in src/lib/kajabi/membership-history.ts — the single
// definition of "what counts as a membership stint", reused here so this
// never disagrees with the "Membership History" display) and their hiatus
// windows (from member_status_overrides, override_type='hiatus').
//
// - firstJoinedAt: the earliest stint start or program / gift coverage start
//   (`otherCoverage`) — unaffected by hiatus.
// - mostRecentJoinedAt: the latest "rejoin" event, where a rejoin is either
//   a real cancel/resubscribe gap (detected the same way the existing
//   resubscription-gap-label UI does) OR an *ended* hiatus. A hiatus is a
//   deliberate substitute for cancel/resubscribe here (re-enrollment is
//   automatic on a hiatus, unlike a real cancellation) and can run a year or
//   more, so returning from one is exactly the "welcome back" moment this
//   field exists to capture. An ongoing hiatus (no end date yet, or an end
//   date still in the future) hasn't "come back" yet and doesn't reset
//   anything. A return through `otherCoverage` counts too: coverage starting
//   after a lapse of at least MIN_RETURN_GAP_DAYS (a member back via a program).
// - totalActiveMonths: total time across all stints, excluding any time
//   that overlapped a hiatus window, in whole months (days/30, matching the
//   convention already used for per-stint duration in MemberDetails.tsx).
export function computeMemberTenure(
  stints: MembershipPurchase[],
  hiatusWindows: HiatusWindow[],
  asOf: Date,
  otherCoverage: ActiveWindow[] = []
): MemberTenure {
  if (stints.length === 0) {
    return { firstJoinedAt: null, mostRecentJoinedAt: null, totalActiveMonths: 0 };
  }

  const ascending = [...stints].sort((a, b) =>
    a.created_at_kajabi.localeCompare(b.created_at_kajabi)
  );

  // Program-cohort and gift / direct Stripe time counts as being a member, so
  // it can move the first-joined date earlier than the first Kajabi stint.
  const firstJoinedAt = [
    toDateOnly(ascending[0].created_at_kajabi),
    ...otherCoverage.map((w) => toDateOnly(w.start)),
  ].reduce((earliest, d) => (d < earliest ? d : earliest));

  const resubscriptionEvents = detectResubscriptions(
    ascending.map((s, i) => ({
      kajabi_purchase_id: String(i),
      effective_start_at: null,
      created_at_kajabi: s.created_at_kajabi,
      deactivated_at: s.derived_end_at,
    }))
  );

  const rejoinCandidates: string[] = resubscriptionEvents.map((e) => toDateOnly(e.resubscribedAt));
  // A return through a program or a gift: the end of a gap in the merged coverage. A gap shorter
  // than MIN_RETURN_GAP_DAYS is a handoff (a cohort ending the day before a membership starts),
  // not a return.
  if (otherCoverage.length > 0) {
    for (const gap of computeInactiveGaps(stints, firstJoinedAt, otherCoverage)) {
      const days = (utcDate(gap.end!).getTime() - utcDate(gap.start).getTime()) / MS_PER_DAY;
      if (days >= MIN_RETURN_GAP_DAYS) rejoinCandidates.push(gap.end!);
    }
  }
  for (const window of hiatusWindows) {
    if (window.endsAt && new Date(window.endsAt).getTime() <= asOf.getTime()) {
      rejoinCandidates.push(window.endsAt);
    }
  }

  const mostRecentJoinedAt =
    rejoinCandidates.length > 0
      ? toDateOnly(
          rejoinCandidates.reduce((latest, candidate) =>
            candidate > latest ? candidate : latest
          )
        )
      : firstJoinedAt;

  const totalActiveDays = ascending.reduce(
    (sum, stint) =>
      sum +
      computeActiveDays(
        stint.created_at_kajabi,
        stint.derived_end_at ?? asOf.toISOString(),
        hiatusWindows,
        asOf
      ),
    0
  );

  return {
    firstJoinedAt,
    mostRecentJoinedAt,
    totalActiveMonths: Math.floor(totalActiveDays / 30),
  };
}

// A member's total active months: the time covered by at least one of their
// Kajabi membership stints, the extra coverage (program-cohort enrollments and
// gift / direct Stripe overrides, the same windows computeInactiveGaps reads),
// and, when there is a join-date override, everything from the override to
// `asOf` ("continuously active since the real join date"). The coverage is
// merged first, so time two sources cover counts once (a duplicate
// subscription, a plan change that overlaps for a day, a program inside a
// membership), and time none covers (the gap between a 2023 membership and a
// 2026 program) is not counted. Hiatus windows are merged too and taken away
// once, however many overlap. Result in whole months of 30 days, the same
// convention as computeMemberTenure. Date-only strings are UTC midnight; an
// open end, or an end after `asOf`, is cut to `asOf`; a start at or after
// `asOf` contributes nothing.
export function computeTotalActiveMonths(
  stints: MembershipPurchase[],
  otherCoverage: ActiveWindow[],
  hiatusWindows: HiatusWindow[],
  joinDateOverride: string | null,
  asOf: Date
): number {
  const asOfMs = asOf.getTime();
  const clip = (start: string, end: string | null): [number, number] | null => {
    const startMs = new Date(start).getTime();
    const endMs = Math.min(end ? new Date(end).getTime() : asOfMs, asOfMs);
    if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) return null;
    return [startMs, endMs];
  };
  const merge = (intervals: ([number, number] | null)[]): [number, number][] => {
    const sorted = intervals.filter((i): i is [number, number] => i !== null).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const merged: [number, number][] = [];
    for (const [start, end] of sorted) {
      const last = merged[merged.length - 1];
      if (last && start <= last[1]) last[1] = Math.max(last[1], end);
      else merged.push([start, end]);
    }
    return merged;
  };

  const coverage = merge([
    ...stints.map((s) => clip(s.created_at_kajabi, s.derived_end_at)),
    ...otherCoverage.map((w) => clip(w.start, w.end)),
    ...(joinDateOverride ? [clip(joinDateOverride, null)] : []),
  ]);
  const hiatus = merge(hiatusWindows.map((w) => clip(w.startsAt, w.endsAt)));

  let activeMs = 0;
  for (const [start, end] of coverage) {
    activeMs += end - start;
    for (const [hStart, hEnd] of hiatus) {
      const overlap = Math.min(end, hEnd) - Math.max(start, hStart);
      if (overlap > 0) activeMs -= overlap;
    }
  }
  return Math.max(0, Math.floor(activeMs / (30 * MS_PER_DAY)));
}

// Total hiatus time across all windows, in whole calendar months (overlapping
// windows merged first, each merged period rounded once; see
// calendarMonthsBetween). Display only: the milestone dates use the same
// merged periods through inactiveShiftMonths.
export function computeCumulativeHiatusMonths(hiatusWindows: HiatusWindow[], asOf: Date): number {
  return mergeInactivePeriods(toInactivePeriods(hiatusWindows, null), asOf).reduce(
    (sum, period) => sum + period.months,
    0
  );
}

// Whether `asOf` falls inside any hiatus window — true whether or not that
// window has a known end date. Used to gate the Hedgieversary milestone
// functions below: a member currently paused isn't accruing active time
// *right now*, so a computed milestone date could otherwise land inside the
// hiatus itself (a real, nonsensical case previously seen in production —
// "membership milestone" while not currently a member).
export function isCurrentlyOnHiatus(hiatusWindows: HiatusWindow[], asOf: Date): boolean {
  const asOfMs = asOf.getTime();
  return hiatusWindows.some((w) => {
    const startMs = new Date(w.startsAt).getTime();
    const endMs = w.endsAt ? new Date(w.endsAt).getTime() : null;
    return startMs <= asOfMs && (endMs === null || endMs > asOfMs);
  });
}

// A dated stretch with no active membership. Dates are "YYYY-MM-DD"; end null
// means it is still going (counted up to `asOf`).
export interface InactivePeriod {
  start: string;
  end: string | null;
}

export interface MergedInactivePeriod {
  start: string;
  end: string;
  months: number; // calendar months, rounded once for the whole merged period
}

// A stretch of non-Kajabi active coverage: a program-cohort enrollment
// (starts_at to expires_at) or a gift / direct Stripe status override. Dates
// are "YYYY-MM-DD" (or an ISO timestamp, cut to its date); end null means open.
export interface ActiveWindow {
  start: string;
  end: string | null;
}

const OPEN_END = "9999-12-31";

// The dated stretches between a member's active coverage with no coverage at
// all: Kajabi membership stints (buildMembershipStints in
// src/lib/kajabi/membership-history.ts, the same definition computeMemberTenure
// and the "Membership History" display use) plus `otherCoverage` (program
// enrollments and gift/direct Stripe overrides: the same notion of "active" as
// buildMembershipTimeline in src/lib/membership-timeline.ts). Coverage is merged
// first, so overlapping or touching windows leave no gap, and a gap is only
// reported when later coverage follows it (no trailing gap). Hiatus is not
// coverage here: it is read live and merged by mergeInactivePeriods.
//
// Gaps that end on or before `earliestStart` (the first-joined date, which a
// join-date override can move later than the first stint) are dropped: they
// happened before the member's Hedgie time began.
//
// Known edge versus the old stint-only pairing: an open-ended stint now covers
// the dates of any later cancelled stint (the member was a member throughout),
// where the old code could report a gap after the cancelled one.
export function computeInactiveGaps(
  stints: MembershipPurchase[],
  earliestStart?: string | null,
  otherCoverage: ActiveWindow[] = []
): InactivePeriod[] {
  const windows = [
    ...stints.map((s) => ({ start: toDateOnly(s.created_at_kajabi), end: s.derived_end_at ? toDateOnly(s.derived_end_at) : OPEN_END })),
    ...otherCoverage.map((w) => ({ start: toDateOnly(w.start), end: w.end ? toDateOnly(w.end) : OPEN_END })),
  ]
    .filter((w) => w.end >= w.start)
    .sort((x, y) => x.start.localeCompare(y.start) || x.end.localeCompare(y.end));

  const gaps: { start: string; end: string }[] = [];
  let coveredUntil: string | null = null;
  for (const w of windows) {
    if (coveredUntil !== null && w.start > coveredUntil) {
      gaps.push({ start: coveredUntil, end: w.start });
    }
    if (coveredUntil === null || w.end > coveredUntil) coveredUntil = w.end;
  }
  return gaps.filter((g) => !earliestStart || g.end > earliestStart);
}

// Hiatus windows plus the stored gaps, as one list of periods. `gaps` null
// (never computed) means hiatus only.
export function toInactivePeriods(
  hiatusWindows: HiatusWindow[],
  gaps: InactivePeriod[] | null | undefined
): InactivePeriod[] {
  return [
    ...hiatusWindows.map((w) => ({
      start: toDateOnly(w.startsAt),
      end: w.endsAt ? toDateOnly(w.endsAt) : null,
    })),
    ...(gaps ?? []),
  ];
}

function utcDate(dateOnly: string): Date {
  return new Date(`${dateOnly}T00:00:00Z`);
}

// Whole calendar months from `start` to `end` (date-only strings), rounded to
// the nearest month: count the full months that fit (EDATE-style, the day of
// month clamped to the month's end), then round up when the leftover is half
// of the next month or more. 2023-09-15 to 2023-12-15 is 3; 2024-01-16 to
// 2025-01-19 is 12 (3 days into a 31-day month); 3 years is 36.
export function calendarMonthsBetween(start: string, end: string): number {
  const s = utcDate(start);
  const e = utcDate(end);
  if (e.getTime() <= s.getTime()) return 0;
  let whole = (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + (e.getUTCMonth() - s.getUTCMonth());
  if (addMonthsClamped(s, whole).getTime() > e.getTime()) whole -= 1;
  const lo = addMonthsClamped(s, whole).getTime();
  const hi = addMonthsClamped(s, whole + 1).getTime();
  const fraction = (e.getTime() - lo) / (hi - lo);
  return fraction >= 0.5 ? whole + 1 : whole;
}

// Sorts the periods, merges the ones that overlap or touch (the spreadsheet
// counted overlapping hiatuses twice; this counts the time once), closes open
// ends at `asOf`, and rounds each merged period to calendar months once.
export function mergeInactivePeriods(periods: InactivePeriod[], asOf: Date): MergedInactivePeriod[] {
  const asOfDate = toDateOnly(asOf.toISOString());
  const normalized = periods
    .map((p) => {
      const end = p.end ?? (asOfDate > p.start ? asOfDate : p.start);
      return { start: p.start, end: end < p.start ? p.start : end };
    })
    .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));

  const merged: { start: string; end: string }[] = [];
  for (const period of normalized) {
    const last = merged[merged.length - 1];
    if (last && period.start <= last.end) {
      if (period.end > last.end) last.end = period.end;
    } else {
      merged.push({ ...period });
    }
  }
  return merged.map((p) => ({ ...p, months: calendarMonthsBetween(p.start, p.end) }));
}

// The date of a milestone (`milestone` active months after `firstJoinedAt`).
// Walks the merged periods in order: a period only pushes the milestone out
// when the milestone, as shifted so far, falls after that period began. A
// milestone already reached before a hiatus or gap never moves.
export function milestoneDate(
  firstJoinedAt: string,
  milestone: number,
  periods: MergedInactivePeriod[]
): Date {
  const first = utcDate(firstJoinedAt);
  let shift = 0;
  for (const period of periods) {
    if (addMonthsClamped(first, milestone + shift).getTime() > utcDate(period.start).getTime()) {
      shift += period.months;
    } else {
      break;
    }
  }
  return addMonthsClamped(first, milestone + shift);
}

// Adds `months` to `date`, clamping the day-of-month to the last day of the
// target month when it would overflow (e.g. Jan 31 + 1 month = Feb 28, not
// Mar 3 — native Date.setMonth would roll over into March).
export function addMonthsClamped(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  const targetMonthIndex = month + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();

  return new Date(Date.UTC(targetYear, targetMonth, Math.min(day, daysInTargetMonth)));
}

// How long after a milestone date passes it's still worth surfacing as
// "recently reached" — mirrors the 90-day Welcome Back window already used
// on this page for rejoins.
const RECENT_MILESTONE_WINDOW_DAYS = 90;

export interface NextHedgieversary {
  nextDate: string | null; // date-only, or null when TBD (currently on hiatus)
  milestoneMonths: number | null; // 6, 12, 24, 36, ...
  recentDate: string | null; // the milestone immediately before nextDate, if it landed within RECENT_MILESTONE_WINDOW_DAYS of asOf
  recentMilestoneMonths: number | null;
}

// The next Hedgieversary milestone date for a member — first-joined date
// shifted forward by the milestone (6 months, then yearly) plus the *inactive*
// time (hiatus + cancel/resubscribe gaps, see milestoneDate) that happened
// before that milestone, so the date reflects real elapsed *active* time
// rather than raw calendar time since first joining. A member
// currently mid-hiatus isn't accruing active time right now regardless of
// whether the hiatus has a known return date — celebrating/surfacing a
// projected date for someone who's paused doesn't make sense until they're
// actually back, so return TBD rather than a date for the whole time
// they're on hiatus, not just for an open-ended one.
//
// A milestone can land just barely in the past with nothing ever having
// surfaced it as reached. Rather than silently jumping straight to the
// following year's milestone, also report that just-passed one as
// `recentDate` when it's within the window above.
export function nextHedgieversaryDate(
  firstJoinedAt: string,
  inactivePeriods: InactivePeriod[],
  isCurrentlyOnHiatus: boolean,
  asOf: Date
): NextHedgieversary {
  if (isCurrentlyOnHiatus) {
    return { nextDate: null, milestoneMonths: null, recentDate: null, recentMilestoneMonths: null };
  }

  const periods = mergeInactivePeriods(inactivePeriods, asOf);
  const MAX_MONTHS = 50 * 12; // 50 years — safety bound, not a real limit

  let milestone = 6;
  let lastPast: { date: Date; milestone: number } | null = null;
  while (milestone <= MAX_MONTHS) {
    const candidate = milestoneDate(firstJoinedAt, milestone, periods);
    if (candidate.getTime() > asOf.getTime()) {
      const isRecent =
        lastPast != null &&
        (asOf.getTime() - lastPast.date.getTime()) / MS_PER_DAY <= RECENT_MILESTONE_WINDOW_DAYS;
      return {
        nextDate: toDateOnly(candidate.toISOString()),
        milestoneMonths: milestone,
        recentDate: isRecent ? toDateOnly(lastPast!.date.toISOString()) : null,
        recentMilestoneMonths: isRecent ? lastPast!.milestone : null,
      };
    }
    lastPast = { date: candidate, milestone };
    milestone = milestone === 6 ? 12 : milestone + 12;
  }

  return { nextDate: null, milestoneMonths: null, recentDate: null, recentMilestoneMonths: null };
}

// Display label for a milestone month count, e.g. 6 -> "6-Month", 36 -> "3-Year".
export function milestoneLabel(months: number): string {
  return months < 12 ? `${months}-Month` : `${Math.round(months / 12)}-Year`;
}

export interface HedgieversaryMilestone {
  date: string; // date-only
  milestoneMonths: number;
}

// Every Hedgieversary milestone reached, or due within `lookaheadDays`, as of
// `asOf` — the backlog + near-term preview for the celebration work queue
// (src/lib/admin-work-queue.ts). Unlike nextHedgieversaryDate above (which only
// ever reports the single next upcoming milestone), this returns every
// milestone in range, so a queue that's fallen behind surfaces all of them
// instead of just the latest.
export function hedgieversaryMilestonesInWindow(
  firstJoinedAt: string,
  inactivePeriods: InactivePeriod[],
  isCurrentlyOnHiatus: boolean,
  asOf: Date,
  lookaheadDays: number
): HedgieversaryMilestone[] {
  if (isCurrentlyOnHiatus) return [];

  const periods = mergeInactivePeriods(inactivePeriods, asOf);
  const windowEndMs = asOf.getTime() + lookaheadDays * MS_PER_DAY;
  const MAX_MONTHS = 50 * 12; // 50 years — safety bound, not a real limit

  const results: HedgieversaryMilestone[] = [];
  let milestone = 6;
  while (milestone <= MAX_MONTHS) {
    const candidate = milestoneDate(firstJoinedAt, milestone, periods);
    if (candidate.getTime() > windowEndMs) break;
    results.push({ date: toDateOnly(candidate.toISOString()), milestoneMonths: milestone });
    milestone = milestone === 6 ? 12 : milestone + 12;
  }
  return results;
}
