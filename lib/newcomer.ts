/**
 * Who counts as a newcomer: a member whose first_joined_at is within the last 90 days, which is
 * also how far back Slack history reaches (the retention window), so "has introduced themselves
 * in #start-here" can always be answered for them. Newcomers get two extra steps in the Getting
 * started tour and, until they do the things, reminders (lib/member-reminders.ts).
 */

export const NEWCOMER_WINDOW_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

/** `first_joined_at` is a date (YYYY-MM-DD) or a timestamp; null for someone who never subscribed. */
export function isNewcomer(firstJoinedAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!firstJoinedAt) return false;
  const joined = new Date(firstJoinedAt).getTime();
  if (Number.isNaN(joined)) return false;
  return now.getTime() - joined <= NEWCOMER_WINDOW_DAYS * DAY_MS;
}

/** Whole days since the member joined (0 on the day), or null without a join date. */
export function daysSinceJoined(firstJoinedAt: string | null | undefined, now: Date = new Date()): number | null {
  if (!firstJoinedAt) return null;
  const joined = new Date(firstJoinedAt).getTime();
  if (Number.isNaN(joined)) return null;
  return Math.max(0, Math.floor((now.getTime() - joined) / DAY_MS));
}
