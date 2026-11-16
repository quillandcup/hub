import { ORG_TIMEZONE } from "@/lib/config";

/**
 * A countdown's target is an instant, stored as a UTC ISO string. The editor takes a wall-clock time in the
 * organization's zone (the community talks in Eastern time), so this turns "2027-03-14T09:00" there into the instant,
 * including across a daylight saving change (dates-and-timezones rule).
 */
export function zonedLocalToUtc(local: string, timeZone: string = ORG_TIMEZONE): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!match) return null;
  const [y, mo, d, h, mi] = match.slice(1).map(Number);
  const wanted = Date.UTC(y, mo - 1, d, h, mi);
  // Find the offset the zone has at that wall time: guess UTC, read the zone's wall time there, correct, and read again
  // (the second pass settles the hour around a daylight saving change).
  let instant = wanted;
  for (let i = 0; i < 2; i++) instant = wanted - (wallTimeAsUtc(instant, timeZone) - instant);
  const date = new Date(instant);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** An instant as the "YYYY-MM-DDTHH:mm" wall time in a zone: what the editor's date field shows. */
export function utcToZonedLocal(iso: string, timeZone: string = ORG_TIMEZONE): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(wallTimeAsUtc(t, timeZone)).toISOString().slice(0, 16);
}

function wallTimeAsUtc(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
}

export type TimeLeft = { days: number; hours: number; minutes: number; seconds: number; expired: boolean };

export function timeLeft(targetIso: string, now: number): TimeLeft | null {
  const target = Date.parse(targetIso);
  if (Number.isNaN(target)) return null;
  const ms = Math.max(0, target - now);
  const total = Math.floor(ms / 1000);
  return { days: Math.floor(total / 86400), hours: Math.floor((total % 86400) / 3600), minutes: Math.floor((total % 3600) / 60), seconds: total % 60, expired: ms === 0 };
}

/** "March 14, 2027 at 9:00 AM EDT": the target in the organization's zone, so a visitor anywhere reads the same time. */
export function describeTarget(targetIso: string, timeZone: string = ORG_TIMEZONE): string {
  const t = Date.parse(targetIso);
  if (Number.isNaN(t)) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(t));
}
