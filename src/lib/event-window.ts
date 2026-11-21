import { ORG_TIMEZONE } from "@/lib/config";
import { zonedTimeToUtc } from "@/lib/prickle-schedules";

/** What an admin types for when an event is: Eastern dates (YYYY-MM-DD) and, optionally, clock times (HH:MM). */
export interface EventWindowInput {
  startDate: string;
  endDate: string;
  /** Empty with `endClock` empty: an all-day event. */
  startClock?: string | null;
  endClock?: string | null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The calendar day after a YYYY-MM-DD date (plain calendar arithmetic, no zone involved). */
function nextDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/**
 * The instants an event runs between, in the organization's timezone. Dates alone make an all-day event: midnight
 * at the start of the first day to midnight after the last day. With times, both are needed.
 */
export function eventWindow(input: EventWindowInput): { ok: true; startTime: string; endTime: string } | { ok: false; error: string } {
  const startClock = input.startClock?.trim() || "";
  const endClock = input.endClock?.trim() || "";
  if (!DATE.test(input.startDate ?? "") || !DATE.test(input.endDate ?? "")) return { ok: false, error: "Start and end dates are required" };
  if (input.endDate < input.startDate) return { ok: false, error: "The event can't end before it starts" };
  if (!startClock !== !endClock) return { ok: false, error: "Give both a start and an end time, or neither for an all-day event" };
  if ((startClock && !CLOCK.test(startClock)) || (endClock && !CLOCK.test(endClock))) return { ok: false, error: "Times are written HH:MM" };

  const start = zonedTimeToUtc(input.startDate, startClock || "00:00", ORG_TIMEZONE);
  const end = startClock ? zonedTimeToUtc(input.endDate, endClock, ORG_TIMEZONE) : zonedTimeToUtc(nextDay(input.endDate), "00:00", ORG_TIMEZONE);
  if (end.getTime() <= start.getTime()) return { ok: false, error: "The event must end after it starts" };
  return { ok: true, startTime: start.toISOString(), endTime: end.toISOString() };
}
