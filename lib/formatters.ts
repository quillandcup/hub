/**
 * Consistent date/time formatting utilities
 * Eliminates duplicate toLocaleString() calls across the app
 */

import { ORG_TIMEZONE } from "@/lib/config";

// A bare toLocaleDateString() formats in the host's zone and locale, so the server (UTC) and the
// browser print different text and React reports a hydration mismatch. These name the zone.
const dateFormats = new Map<string, Intl.DateTimeFormat>();
const dateOnlyFormat = new Intl.DateTimeFormat("en-US", { timeZone: "UTC" });

/**
 * Format an instant as its calendar date in `timeZone` (the viewer's: `useTimeZone()` in a client
 * component, `getViewerTimeZone()` on the server), the same on server and client
 * Example: "7/19/2026"
 */
export function formatDateInZone(date: Date | string, timeZone: string): string {
  let format = dateFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", { timeZone });
    dateFormats.set(timeZone, format);
  }
  return format.format(typeof date === "string" ? new Date(date) : date);
}

/**
 * Format a "YYYY-MM-DD" date-only value (a timestamp's first ten characters are used) without
 * shifting it through any timezone
 * Example: "2026-07-19" -> "7/19/2026"
 */
export function formatDateOnly(dateOnly: string): string {
  const [y, m, d] = dateOnly.slice(0, 10).split("-").map(Number);
  return dateOnlyFormat.format(new Date(Date.UTC(y, m - 1, d)));
}

const dateTimeFormats = new Map<string, Intl.DateTimeFormat>();
const timeFormats = new Map<string, Intl.DateTimeFormat>();

function toDate(date: Date | string): Date {
  return typeof date === "string" ? new Date(date) : date;
}

function timeFormat(timeZone: string): Intl.DateTimeFormat {
  let format = timeFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone });
    timeFormats.set(timeZone, format);
  }
  return format;
}

/**
 * Format date and time without seconds, in `timeZone` (the viewer's for per-member content,
 * `ORG_TIMEZONE` by default; never the host's zone)
 * Example: "7/19/2026, 10:00 AM"
 */
export function formatDateTime(date: Date | string, timeZone: string = ORG_TIMEZONE): string {
  let format = dateTimeFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    });
    dateTimeFormats.set(timeZone, format);
  }
  return format.format(toDate(date));
}

/**
 * Format time only without seconds, in `timeZone`
 * Example: "10:00 AM"
 */
export function formatTime(date: Date | string, timeZone: string = ORG_TIMEZONE): string {
  return timeFormat(timeZone).format(toDate(date));
}

/**
 * Format date only, in `timeZone`
 * Example: "7/19/2026"
 */
export function formatDate(date: Date | string, timeZone: string = ORG_TIMEZONE): string {
  return formatDateInZone(date, timeZone);
}

/**
 * Format a date and time range in `timeZone`
 * Example: "7/19/2026, 10:00 AM - 11:00 AM"
 */
export function formatDateTimeRange(
  start: Date | string,
  end: Date | string,
  timeZone: string = ORG_TIMEZONE
): string {
  // If same day (in that zone), show date once
  if (formatDate(start, timeZone) === formatDate(end, timeZone)) {
    return `${formatDate(start, timeZone)}, ${formatTime(start, timeZone)} - ${formatTime(end, timeZone)}`;
  }

  // Different days, show full date/time for both
  return `${formatDateTime(start, timeZone)} - ${formatDateTime(end, timeZone)}`;
}

/**
 * Format a time range (same day)
 * Example: "10:00 AM - 11:00 AM"
 */
export function formatTimeRange(
  start: Date | string,
  end: Date | string,
  timeZone: string = ORG_TIMEZONE
): string {
  return `${formatTime(start, timeZone)} - ${formatTime(end, timeZone)}`;
}

/**
 * Format a name as "First L" (first name + last initial)
 * Example: "Jenn Peterson" -> "Jenn P"
 */
export function hostShortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return parts[0] ?? name;
  return `${parts[0]} ${parts[parts.length - 1][0]}`;
}

type NameRef = { name: string } | { name: string }[] | null | undefined;

function unwrapRef<T extends { name: string }>(ref: T | T[] | null | undefined): T | undefined {
  return Array.isArray(ref) ? ref[0] : ref ?? undefined;
}

/**
 * Format a page title for a prickle, e.g. "Monday Progress Prickle with Jenn P"
 */
export function formatPrickleTitle(prickle: {
  title?: string | null;
  start_time: string;
  host?: NameRef;
  prickle_types?: NameRef;
}): string {
  if (prickle.title) return prickle.title;
  const host = unwrapRef(prickle.host);
  const prickleType = unwrapRef(prickle.prickle_types);
  const weekday = new Date(prickle.start_time).toLocaleDateString("en-US", { weekday: "long", timeZone: ORG_TIMEZONE });
  const typeName = prickleType?.name ?? "Prickle";
  return host?.name ? `${weekday} ${typeName} with ${hostShortName(host.name)}` : `${weekday} ${typeName}`;
}

/** formatPrickleTitle for a prickle read through the repository (type and host already joined). */
export function formatPrickleDetailTitle(prickle: {
  title: string | null;
  startTime: string;
  host: { name: string } | null;
  type: { name: string } | null;
}): string {
  return formatPrickleTitle({ title: prickle.title, start_time: prickle.startTime, host: prickle.host, prickle_types: prickle.type });
}

/**
 * Format a relative time
 * Example: "2 hours ago", "in 3 days"
 */
export function formatRelativeTime(date: Date | string, timeZone: string = ORG_TIMEZONE): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffMins = Math.floor(Math.abs(diffMs) / (1000 * 60));
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  const isPast = diffMs < 0;

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return isPast ? `${diffMins}m ago` : `in ${diffMins}m`;
  if (diffHours < 24) return isPast ? `${diffHours}h ago` : `in ${diffHours}h`;
  if (diffDays < 30) return isPast ? `${diffDays}d ago` : `in ${diffDays}d`;

  return formatDate(d, timeZone);
}
