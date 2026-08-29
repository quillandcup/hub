import { detectResubscriptions } from "@/lib/resubscription-detection";
import type { MembershipPurchase } from "@/lib/kajabi/membership-history";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

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
// buildMembershipStints in lib/kajabi/membership-history.ts — the single
// definition of "what counts as a membership stint", reused here so this
// never disagrees with the "Membership History" display) and their hiatus
// windows (from member_status_overrides, override_type='hiatus').
//
// - firstJoinedAt: the earliest stint start — unaffected by hiatus.
// - mostRecentJoinedAt: the latest "rejoin" event, where a rejoin is either
//   a real cancel/resubscribe gap (detected the same way the existing
//   resubscription-gap-label UI does) OR an *ended* hiatus. A hiatus is a
//   deliberate substitute for cancel/resubscribe here (re-enrollment is
//   automatic on a hiatus, unlike a real cancellation) and can run a year or
//   more, so returning from one is exactly the "welcome back" moment this
//   field exists to capture. An ongoing hiatus (no end date yet, or an end
//   date still in the future) hasn't "come back" yet and doesn't reset
//   anything.
// - totalActiveMonths: total time across all stints, excluding any time
//   that overlapped a hiatus window, in whole months (days/30, matching the
//   convention already used for per-stint duration in MemberDetails.tsx).
export function computeMemberTenure(
  stints: MembershipPurchase[],
  hiatusWindows: HiatusWindow[],
  asOf: Date
): MemberTenure {
  if (stints.length === 0) {
    return { firstJoinedAt: null, mostRecentJoinedAt: null, totalActiveMonths: 0 };
  }

  const ascending = [...stints].sort((a, b) =>
    a.created_at_kajabi.localeCompare(b.created_at_kajabi)
  );

  const firstJoinedAt = toDateOnly(ascending[0].created_at_kajabi);

  const resubscriptionEvents = detectResubscriptions(
    ascending.map((s, i) => ({
      kajabi_purchase_id: String(i),
      effective_start_at: null,
      created_at_kajabi: s.created_at_kajabi,
      deactivated_at: s.derived_end_at,
    }))
  );

  const rejoinCandidates: string[] = resubscriptionEvents.map((e) => e.resubscribedAt);
  for (const window of hiatusWindows) {
    if (window.endsAt && new Date(window.endsAt).getTime() <= asOf.getTime()) {
      rejoinCandidates.push(window.endsAt);
    }
  }

  const mostRecentJoinedAt =
    rejoinCandidates.length > 0
      ? toDateOnly(
          rejoinCandidates.reduce((latest, candidate) =>
            new Date(candidate).getTime() > new Date(latest).getTime() ? candidate : latest
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

// Total hiatus time across all windows, in whole months (rounded — this
// feeds a calendar date shift for nextHedgieversaryDate below, so it needs
// to be a round month count, not a lossy floored duration).
export function computeCumulativeHiatusMonths(hiatusWindows: HiatusWindow[], asOf: Date): number {
  const totalDays = hiatusWindows.reduce((sum, window) => {
    const startMs = new Date(window.startsAt).getTime();
    const endMs = window.endsAt ? new Date(window.endsAt).getTime() : asOf.getTime();
    return sum + Math.max(0, (endMs - startMs) / MS_PER_DAY);
  }, 0);
  return Math.round(totalDays / 30);
}

// Adds `months` to `date`, clamping the day-of-month to the last day of the
// target month when it would overflow (e.g. Jan 31 + 1 month = Feb 28, not
// Mar 3 — native Date.setMonth would roll over into March).
function addMonthsClamped(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  const targetMonthIndex = month + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();

  return new Date(Date.UTC(targetYear, targetMonth, Math.min(day, daysInTargetMonth)));
}

export interface NextHedgieversary {
  nextDate: string | null; // date-only, or null when TBD (ongoing indefinite hiatus)
  milestoneMonths: number | null; // 6, 12, 24, 36, ...
}

// The next Hedgieversary milestone date for a member — first-joined date
// shifted forward by the milestone (6 months, then yearly) plus their
// cumulative hiatus time, so the date reflects real elapsed *active* time,
// matching how the spreadsheet this replaces computes "Next Date". A member
// currently on an indefinite hiatus (no known end date) has no predictable
// date — return TBD rather than guessing.
export function nextHedgieversaryDate(
  firstJoinedAt: string,
  cumulativeHiatusMonths: number,
  isOnIndefiniteHiatus: boolean,
  asOf: Date
): NextHedgieversary {
  if (isOnIndefiniteHiatus) {
    return { nextDate: null, milestoneMonths: null };
  }

  const start = new Date(`${firstJoinedAt}T00:00:00Z`);
  const MAX_MONTHS = 50 * 12; // 50 years — safety bound, not a real limit

  let milestone = 6;
  while (milestone <= MAX_MONTHS) {
    const candidate = addMonthsClamped(start, milestone + cumulativeHiatusMonths);
    if (candidate.getTime() > asOf.getTime()) {
      return { nextDate: toDateOnly(candidate.toISOString()), milestoneMonths: milestone };
    }
    milestone = milestone === 6 ? 12 : milestone + 12;
  }

  return { nextDate: null, milestoneMonths: null };
}
