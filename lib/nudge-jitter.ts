import { ORG_TIMEZONE } from "@/lib/config";

/**
 * Stable per-member jitter for reminders, so they don't all land at one minute of one weekday on a
 * fixed rhythm. Derived from a seed (member id + kind + how many they've had), not random, so the
 * hourly job agrees with itself from run to run and needs no stored schedule, while the hour and
 * the gap still change after every reminder.
 */

/** FNV-1a hash of the seed with a final mix (so seeds differing in the last character still differ throughout), as a number in [0, 1). */
export function hashUnit(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b) >>> 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35) >>> 0;
  hash ^= hash >>> 16;
  return (hash >>> 0) / 0x100000000;
}

/** Daytime window reminders go out in, in the member's own timezone: 9:00 through 17:59. */
export const SEND_HOUR_START = 9;
export const SEND_HOUR_COUNT = 9;

/** The hour (in the member's timezone) their next reminder goes out. */
export function sendHourFor(seed: string): number {
  return SEND_HOUR_START + Math.floor(hashUnit(`hour:${seed}`) * SEND_HOUR_COUNT);
}

/** The hour of day (0-23) at `now` in `timeZone`. */
export function currentHour(now: Date, timeZone: string = ORG_TIMEZONE): number {
  const hour = new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone }).format(now);
  return Number(hour);
}

/**
 * A gap in days moved by up to ~15% either way (at least a day), a different amount after each
 * reminder: a weekly rhythm becomes 6 to 8 days, so the weekday drifts instead of staying put.
 */
export function jitteredGapDays(baseDays: number, seed: string): number {
  const spread = Math.max(1, Math.round(baseDays * 0.15));
  return baseDays + Math.floor(hashUnit(`gap:${seed}`) * (2 * spread + 1)) - spread;
}

/** The calendar date (YYYY-MM-DD) at `at` in `timeZone`. */
function localDate(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/**
 * Whole calendar days from `from` to `to` in `timeZone`. Reminders go out in a different hour
 * each time, so comparing elapsed time would push one back a day whenever its hour comes earlier
 * than the last one's.
 */
export function calendarDaysBetween(from: Date, to: Date, timeZone: string = ORG_TIMEZONE): number {
  const day = (d: Date) => Date.parse(`${localDate(d, timeZone)}T00:00:00Z`);
  return Math.round((day(to) - day(from)) / (24 * 60 * 60 * 1000));
}
