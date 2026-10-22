import { ORG_TIMEZONE } from "@/lib/config";

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(key: string, timeZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const id = `${key}|${timeZone}`;
  let f = formatters.get(id);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { ...options, timeZone });
    formatters.set(id, f);
  }
  return f;
}

/** "Oct 9, 2:15 PM" in `timeZone` (the reader's; the organization's when none is given). */
export function formatChatTime(iso: string, timeZone: string = ORG_TIMEZONE): string {
  return formatter("stamp", timeZone, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

/** "2:15 PM" in `timeZone`. */
export function formatChatClock(iso: string, timeZone: string = ORG_TIMEZONE): string {
  return formatter("clock", timeZone, { hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

/** The calendar day of `iso` in `timeZone` as YYYY-MM-DD: messages with the same key share a day marker. */
export function chatDayKey(iso: string, timeZone: string = ORG_TIMEZONE): string {
  const parts = formatter("day", timeZone, { year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

const ordinal = (n: number) => {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
};

/** "Wednesday, October 7th": the label of a day marker, in `timeZone`. */
export function formatChatDay(iso: string, timeZone: string = ORG_TIMEZONE): string {
  const parts = formatter("label", timeZone, { weekday: "long", month: "long", day: "numeric" }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")}, ${get("month")} ${ordinal(Number(get("day")))}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: string | undefined | null): value is string => Boolean(value && UUID_RE.test(value));

/** A valid ISO timestamp from a query param, or null. */
export function parseBefore(value: string | string[] | undefined): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** The first value of a query param. */
export const firstParam = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

/** Midnight UTC of a YYYY-MM-DD query param (plus `addDays`), or null when it isn't a real date. */
export function parseDay(value: string | string[] | undefined, addDays = 0): string | null {
  const v = firstParam(value);
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const t = Date.parse(`${v}T00:00:00Z`);
  return Number.isNaN(t) ? null : new Date(t + addDays * 86_400_000).toISOString();
}
