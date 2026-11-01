/**
 * A member's optional secondary time zone (Settings → Preferences, `user_profiles.secondary_timezone`),
 * like Google Calendar's "additional time zone". Prickles are announced in Eastern whatever a
 * member's own zone, so many want it shown beside theirs; it's off by default.
 */

const wallClock = (timeZone: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "numeric", minute: "2-digit" });

/**
 * The reading of an instant in the secondary zone, like "7:00 AM ET" (with the weekday when the
 * day differs from the viewer's, "Fri 1:00 AM ET"). Empty when there's no secondary zone, or when
 * it shows the same wall clock as the viewer's zone.
 */
export function secondaryTimeNote(instant: Date | string, timeZone: string, secondaryZone: string | null): string {
  if (!secondaryZone) return "";
  const date = typeof instant === "string" ? new Date(instant) : instant;
  if (wallClock(timeZone).format(date) === wallClock(secondaryZone).format(date)) return "";
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: secondaryZone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "shortGeneric",
  }).format(date);
  const day = new Intl.DateTimeFormat("en-US", { timeZone: secondaryZone, weekday: "short" }).format(date);
  const viewerDay = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(date);
  return day === viewerDay ? time : `${day} ${time}`;
}

/** `text` followed by the secondary reading in parentheses when there is one: "5:00 AM (7:00 AM ET)". */
export function withSecondaryTime(text: string, instant: Date | string, timeZone: string, secondaryZone: string | null): string {
  const note = secondaryTimeNote(instant, timeZone, secondaryZone);
  return note ? `${text} (${note})` : text;
}
