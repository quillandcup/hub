import { chatDayKey } from "@/lib/chat/format";
import { zonedTimeToUtc } from "@/lib/prickle-schedules";

/** The ways to jump in a conversation (the menu's options; also what the usage event records). */
export const JUMP_OPTIONS = ["today", "yesterday", "last_week", "last_month", "beginning"] as const;
export type JumpOption = (typeof JUMP_OPTIONS)[number] | "date";

/** The instant "the very beginning" jumps to: before any message. */
export const BEGINNING = "1970-01-01T00:00:00.000Z";

const parse = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return { y, m, d };
};
const pad = (n: number) => String(n).padStart(2, "0");
const format = (y: number, m: number, d: number) => `${String(y).padStart(4, "0")}-${pad(m)}-${pad(d)}`;

/** A calendar day (YYYY-MM-DD) `days` later (or earlier, when negative): plain calendar arithmetic, no zone involved. */
export function addDays(day: string, days: number): string {
  const { y, m, d } = parse(day);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return format(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** The same day of the previous month, or that month's last day when it is shorter (March 31 -> February 28). */
export function previousMonth(day: string): string {
  const { y, m, d } = parse(day);
  const year = m === 1 ? y - 1 : y;
  const month = m === 1 ? 12 : m - 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return format(year, month, Math.min(d, last));
}

/** The day `option` points at, as seen from `now` in `timeZone`, or null for "the very beginning" (which is not a day). */
export function jumpDay(option: Exclude<JumpOption, "date">, now: Date, timeZone: string): string | null {
  const today = chatDayKey(now.toISOString(), timeZone);
  switch (option) {
    case "today":
      return today;
    case "yesterday":
      return addDays(today, -1);
    case "last_week":
      return addDays(today, -7);
    case "last_month":
      return previousMonth(today);
    case "beginning":
      return null;
  }
}

/** The instant a day starts in `timeZone` (an ISO string), the `?from=` of a jump to that day. */
export function dayStartIso(day: string, timeZone: string): string {
  return zonedTimeToUtc(day, "00:00", timeZone).toISOString();
}

/** The `?from=` value for a jump: the start of the chosen day, or the beginning of time. */
export function jumpFrom(option: Exclude<JumpOption, "date">, now: Date, timeZone: string): string {
  const day = jumpDay(option, now, timeZone);
  return day ? dayStartIso(day, timeZone) : BEGINNING;
}

/** The conversation's address for a window starting at `from`. */
export const jumpHref = (channelId: string, from: string) => `/chat/${channelId}?from=${encodeURIComponent(from)}`;
