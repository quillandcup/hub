import { orgYmd, type Ymd } from "@/lib/org-week";
import { endOfOrgDay, isRealDay, startOfOrgDay } from "@/lib/care";

/**
 * A range of Eastern calendar days for a feed, as the URL writes it (?from=YYYY-MM-DD&to=YYYY-MM-DD). Both ends are days, not
 * instants: `from` starts at 00:00 Eastern, and the whole `to` day is included (the range ends at the next Eastern midnight), so
 * a 23- or 25-hour daylight saving day is read as the one day it is. Pure, so a page can adopt it without a clock or a zone of
 * its own (docs/ACTIVITY_AND_AUDIT_LOG.md, "Date range").
 */
export interface DayRange {
  /** First day, inclusive. */
  from: Ymd;
  /** Last day, inclusive. */
  to: Ymd;
}

/**
 * The earliest day a range can name, and where "all time" starts. A day before it is not a date anyone meant (a typo like
 * 0026, or a year the database has nothing for), so it is refused like any other bad value. Not a business fact: it only
 * keeps a garbage year from reaching the database.
 */
export const RANGE_FLOOR: Ymd = "2000-01-01";

export interface ParsedRange {
  range: DayRange | null;
  /** Why the values in the URL were not used, in a sentence for the page; null when there was nothing wrong. */
  notice: string | null;
}

const USUAL = "so the usual range is shown";
export const RANGE_NOTICES = {
  invalid: `Those dates weren't valid, ${USUAL}.`,
  reversed: `The From day was after the To day, ${USUAL}.`,
  future: `That range hasn't happened yet, ${USUAL}.`,
} as const;

type Param = string | string[] | undefined;
const day = (value: Param): string | undefined => {
  const v = (Array.isArray(value) ? value[0] : value)?.trim();
  return v ? v : undefined;
};

/**
 * The range a URL asks for. Neither value present is no range (not a problem). Only From means From to today, only To means
 * the floor to To. A To day after today is cut to today (nothing has happened later); anything not a real day, a range that
 * runs backwards and a range that starts after today give no range and a `notice`, never an error.
 */
export function parseDayRange(from: Param, to: Param, now: Date): ParsedRange {
  const rawFrom = day(from);
  const rawTo = day(to);
  if (rawFrom === undefined && rawTo === undefined) return { range: null, notice: null };

  const today = orgYmd(now);
  const start = rawFrom ?? RANGE_FLOOR;
  const end = rawTo ?? today;
  if (!isRealDay(start) || !isRealDay(end) || start < RANGE_FLOOR || end < RANGE_FLOOR) return { range: null, notice: RANGE_NOTICES.invalid };
  if (start > today) return { range: null, notice: RANGE_NOTICES.future };
  const last = end > today ? today : end;
  if (start > last) return { range: null, notice: RANGE_NOTICES.reversed };
  return { range: { from: start, to: last }, notice: null };
}

/** The instants a range covers: [from, to), from 00:00 Eastern of the first day to 00:00 Eastern of the day after the last. */
export function rangeInstants(range: DayRange): { from: Date; to: Date } {
  return { from: startOfOrgDay(range.from), to: endOfOrgDay(range.to) };
}

/** The first Eastern instant that "all time" covers. */
export function allTimeStart(): Date {
  return startOfOrgDay(RANGE_FLOOR);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "3 Nov", or "3 Nov 2025" with the year. Pure string work: no zone can move the day. */
export function formatRangeDay(ymd: Ymd, withYear: boolean): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}${withYear ? ` ${y}` : ""}`;
}

/**
 * A range in words: "3 Nov to 17 Nov", "3 Nov" for one day, "up to 17 Nov" when it starts at the floor. The year is shown when the
 * range is not wholly in the current Eastern year (`now`), so an old range never reads as this year's.
 */
export function describeRange(range: DayRange, now: Date): string {
  const year = orgYmd(now).slice(0, 4);
  const withYear = range.from.slice(0, 4) !== year || range.to.slice(0, 4) !== year;
  if (range.from === RANGE_FLOOR) return `up to ${formatRangeDay(range.to, range.to.slice(0, 4) !== year)}`;
  if (range.from === range.to) return formatRangeDay(range.from, withYear);
  return `${formatRangeDay(range.from, withYear)} to ${formatRangeDay(range.to, withYear)}`;
}
