import { ORG_TIMEZONE } from "@/lib/config";

const wallClock = (timeZone: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "numeric", minute: "2-digit" });

const orgClock = new Intl.DateTimeFormat("en-US", {
  timeZone: ORG_TIMEZONE,
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "shortGeneric",
});
const orgWeekday = new Intl.DateTimeFormat("en-US", { timeZone: ORG_TIMEZONE, weekday: "short" });

/**
 * The org-time (Eastern) reading of an instant, like "7:00 AM ET" (with the weekday when the day
 * differs from the viewer's, "Fri 1:00 AM ET"). Empty when `timeZone` shows the same wall clock, so
 * a viewer in Eastern sees nothing extra. Members talk about prickles in Eastern whatever their zone.
 */
export function orgTimeNote(instant: Date | string, timeZone: string): string {
  const date = typeof instant === "string" ? new Date(instant) : instant;
  if (wallClock(timeZone).format(date) === wallClock(ORG_TIMEZONE).format(date)) return "";
  const time = orgClock.format(date);
  const day = orgWeekday.format(date);
  const viewerDay = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(date);
  return day === viewerDay ? time : `${day} ${time}`;
}

/** `text` followed by the Eastern reading in parentheses when it differs: "5:00 AM (7:00 AM ET)". */
export function withOrgTime(text: string, instant: Date | string, timeZone: string): string {
  const note = orgTimeNote(instant, timeZone);
  return note ? `${text} (${note})` : text;
}
