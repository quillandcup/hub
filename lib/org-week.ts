import { ORG_TIMEZONE } from "@/lib/config";
import { zonedTimeToUtc } from "@/lib/prickle-schedules";

/** A calendar date as "YYYY-MM-DD", with no zone attached. */
export type Ymd = string;

const ymdParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: ORG_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The org-zone (Eastern) calendar date of an instant. */
export function orgYmd(instant: Date): Ymd {
  return ymdParts.format(instant);
}

function addDays(ymd: Ymd, days: number): Ymd {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The Sunday on or before a calendar date. Pure date arithmetic, so no zone can shift it. */
export function sundayOnOrBefore(ymd: Ymd): Ymd {
  const [y, m, d] = ymd.split("-").map(Number);
  return addDays(ymd, -new Date(Date.UTC(y, m - 1, d)).getUTCDay());
}

/**
 * The org-zone week (Sunday to Sunday) containing `weekParam` ("YYYY-MM-DD"), or the one
 * containing `now` when the param is missing or malformed. `startInstant` and `endInstant` bound it
 * as UTC instants (a week with a daylight saving change is 167 or 169 hours long).
 */
export function orgWeek(weekParam: string | undefined, now: Date) {
  const valid = weekParam !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(weekParam);
  const start = sundayOnOrBefore(valid ? weekParam : orgYmd(now));
  return {
    start,
    prev: addDays(start, -7),
    next: addDays(start, 7),
    today: orgYmd(now),
    startInstant: zonedTimeToUtc(start, "00:00", ORG_TIMEZONE),
    endInstant: zonedTimeToUtc(addDays(start, 7), "00:00", ORG_TIMEZONE),
  };
}
