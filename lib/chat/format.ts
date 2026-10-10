import { ORG_TIMEZONE } from "@/lib/config";

const stamp = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: ORG_TIMEZONE,
});

/** "Oct 9, 2:15 PM" in the organization's timezone, so everyone reads the same clock. */
export function formatChatTime(iso: string): string {
  return stamp.format(new Date(iso));
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
