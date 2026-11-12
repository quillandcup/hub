/**
 * What Slack DMs say about "who spoke last" in a Hedgie Care engagement (docs/HEDGIE_CARE.md, "Slack DMs fill it in").
 * Pure: no database, no Slack. The reads and writes are in lib/care-dm.ts. Only times appear here, never message text.
 */
import { ORG_TIMEZONE } from "@/lib/config";
import { orgYmd } from "@/lib/org-week";
import { zonedTimeToUtc } from "@/lib/prickle-schedules";
import type { CareTimes } from "@/lib/care";

/**
 * The earliest moment a DM message counts for an engagement: the start of the Eastern calendar day it was opened on. A
 * message she sent just before logging the start of the engagement (earlier the same day) still counts; yesterday's does
 * not. A calendar day, not 24 hours, so a clock-change day (23 or 25 hours) and an evening opening (already tomorrow in UTC)
 * both land on the right midnight.
 */
export function dmCountsFrom(openedAt: string | Date): Date {
  const opened = typeof openedAt === "string" ? new Date(openedAt) : openedAt;
  return zonedTimeToUtc(orgYmd(opened), "00:00", ORG_TIMEZONE);
}

/** When the staff member and the member last wrote in their DM (each null when they never have, or Bronze has nothing). */
export type DmLastWrites = { staffAt: string | null; memberAt: string | null };

/** The times to move forward on an engagement; a key is absent when that side has nothing newer to say. */
export type DerivedMessageTimes = { staffAt?: string; memberAt?: string };

const later = (candidate: string, stored: string | null) => stored === null || Date.parse(candidate) > Date.parse(stored);

/**
 * Of the last-written times of a tracked DM, the ones that move an open engagement forward: a time counts when it is on or
 * after `dmCountsFrom(opened_at)` and later than what is already stored (a manual log or an earlier derivation), so the
 * result never moves a time back, never repeats one (applying it twice changes nothing), and ignores everything from
 * before the engagement. The times are the latest message of each person, so a later message supersedes an earlier one and
 * nothing older matters.
 */
export function derivedMessageTimes(
  engagement: Pick<CareTimes, "opened_at" | "last_staff_message_at" | "last_member_message_at">,
  writes: DmLastWrites
): DerivedMessageTimes {
  const from = dmCountsFrom(engagement.opened_at).getTime();
  const counts = (at: string | null): at is string => at !== null && Date.parse(at) >= from;
  const out: DerivedMessageTimes = {};
  if (counts(writes.staffAt) && later(writes.staffAt, engagement.last_staff_message_at)) out.staffAt = new Date(writes.staffAt).toISOString();
  if (counts(writes.memberAt) && later(writes.memberAt, engagement.last_member_message_at)) out.memberAt = new Date(writes.memberAt).toISOString();
  return out;
}

/** Who wrote last in a DM, and when: null when neither has written. */
export function lastWriter(writes: DmLastWrites): { who: "staff" | "member"; at: string } | null {
  const staff = writes.staffAt ? Date.parse(writes.staffAt) : null;
  const member = writes.memberAt ? Date.parse(writes.memberAt) : null;
  if (staff === null && member === null) return null;
  if (member === null || (staff !== null && staff >= member)) return { who: "staff", at: writes.staffAt as string };
  return { who: "member", at: writes.memberAt as string };
}
