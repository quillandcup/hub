/**
 * Minimal iCalendar (RFC 5545) writer for published, subscribable feeds -- just what the
 * personal calendar feed needs (lib/calendar-feed.ts): UTC timed events and all-day events, with
 * an optional location, URL and display reminder.
 */

export interface ICalEvent {
  /** Globally unique and stable across feed refreshes, so calendar apps update the event in
   * place instead of duplicating it. */
  uid: string;
  /** Timed: the start instant. All-day: the first day, as UTC midnight. */
  start: Date;
  /** Timed: the end instant. All-day: the day after the last day (exclusive), as UTC midnight. */
  end: Date;
  allDay?: boolean;
  summary: string;
  description?: string;
  location?: string;
  url?: string;
  status?: "CONFIRMED" | "TENTATIVE";
  /** Minutes before start for a display alarm; omit for none. */
  reminderMinutes?: number;
}

export interface ICalCalendar {
  /** Shown as the calendar's name when subscribing (X-WR-CALNAME). */
  name: string;
  description?: string;
  /** How often clients should re-fetch, in minutes (REFRESH-INTERVAL / X-PUBLISHED-TTL). Google
   * ignores it and refreshes on its own schedule (roughly every 12-24 hours). */
  refreshMinutes?: number;
  events: ICalEvent[];
}

const PRODID = "-//Quill & Cup//Hedgie Hub//EN";

/** Escape a TEXT value: backslash, semicolon, comma, and newlines. */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** UTC DATE-TIME, e.g. 20260928T140000Z. */
export function formatUtc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** DATE value, e.g. 20260928, from the UTC calendar date. */
export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

/**
 * Fold a content line to at most 75 octets per physical line (continuations start with a space),
 * never splitting a multi-byte UTF-8 character.
 */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    // The first line holds 75 octets; continuation lines hold 74 after their leading space.
    const limit = parts.length === 0 ? 75 : 74;
    if (currentBytes + bytes > limit) {
      parts.push(current);
      current = "";
      currentBytes = 0;
    }
    current += char;
    currentBytes += bytes;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

function eventLines(event: ICalEvent, stamp: string): string[] {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${stamp}`,
    event.allDay ? `DTSTART;VALUE=DATE:${formatDate(event.start)}` : `DTSTART:${formatUtc(event.start)}`,
    event.allDay ? `DTEND;VALUE=DATE:${formatDate(event.end)}` : `DTEND:${formatUtc(event.end)}`,
    `SUMMARY:${escapeText(event.summary)}`,
  ];
  if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
  if (event.url) lines.push(`URL:${event.url}`);
  lines.push(`STATUS:${event.status ?? "CONFIRMED"}`);
  if (event.reminderMinutes !== undefined) {
    lines.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeText(event.summary)}`,
      `TRIGGER:-PT${event.reminderMinutes}M`,
      "END:VALARM"
    );
  }
  lines.push("END:VEVENT");
  return lines;
}

/** The whole calendar as an iCalendar document (CRLF line endings, folded lines). */
export function renderICalendar(calendar: ICalCalendar, now: Date = new Date()): string {
  const stamp = formatUtc(now);
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:${PRODID}`, "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  lines.push(`X-WR-CALNAME:${escapeText(calendar.name)}`);
  if (calendar.description) lines.push(`X-WR-CALDESC:${escapeText(calendar.description)}`);
  if (calendar.refreshMinutes) {
    lines.push(`REFRESH-INTERVAL;VALUE=DURATION:PT${calendar.refreshMinutes}M`);
    lines.push(`X-PUBLISHED-TTL:PT${calendar.refreshMinutes}M`);
  }
  for (const event of calendar.events) lines.push(...eventLines(event, stamp));
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
