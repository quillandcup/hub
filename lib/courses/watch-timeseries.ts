import type { PlaySession } from "@/lib/courses/watch-stats";

/**
 * A video's activity over time, like Kajabi's Analytics modal: one metric by day, week or month over a
 * date range. Pure, so it is tested without a database.
 *
 * Everything is attributed to the day a *visit* (player session) began, in the organisation's
 * timezone: a visit rarely spans days, and it keeps "plays", "views" and "hours" on one clock. Dates
 * here are local `YYYY-MM-DD` strings, never instants, so a range means whole local days.
 */

export type Metric = "total_plays" | "unique_plays" | "unique_viewers" | "play_rate" | "engagement_rate" | "hours_watched";
export type Granularity = "day" | "week" | "month";
export type RangePreset = "today" | "7d" | "30d" | "last_month" | "this_month" | "last_quarter" | "this_quarter" | "this_year" | "12m" | "all" | "custom";
export type Unit = "count" | "percent" | "hours";

export const METRICS: { value: Metric; label: string; unit: Unit; definition: string }[] = [
  { value: "total_plays", label: "Total plays", unit: "count", definition: "Visits to the lesson in which the video was played at all. The same member coming back counts again." },
  { value: "unique_plays", label: "Unique plays", unit: "count", definition: "Different members who played the video, counting each member once however many times they played it." },
  { value: "unique_viewers", label: "Unique viewers", unit: "count", definition: "Different members who opened the video, whether or not they played it." },
  { value: "play_rate", label: "Play rate", unit: "percent", definition: "The percentage of visits to the lesson, where the video appeared, in which it was played." },
  { value: "engagement_rate", label: "Engagement rate", unit: "percent", definition: "Total watch time divided by (plays × video length): how much of the video people play. Replaying a part adds to it, so it can pass 100%." },
  { value: "hours_watched", label: "Hours watched", unit: "hours", definition: "Video time played, rewatching included, in hours." },
];

export const RANGES: { value: RangePreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "last_month", label: "Last month" },
  { value: "this_month", label: "This month" },
  { value: "last_quarter", label: "Last quarter" },
  { value: "this_quarter", label: "This quarter" },
  { value: "this_year", label: "This year" },
  { value: "12m", label: "Last 12 months" },
  { value: "all", label: "All time" },
  { value: "custom", label: "Custom range" },
];

export const GRANULARITIES: { value: Granularity; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

/** A range of whole local days, both ends included. */
export interface DateRange {
  from: string;
  to: string;
}

/** The most points one chart draws: a longer daily range is shown by week instead. */
export const MAX_POINTS = 400;
const EARLIEST = "2000-01-01";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const toUtc = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (date: string, days: number) => fromUtc(toUtc(date) + days * 86_400_000);
const daysBetween = (from: string, to: string) => Math.round((toUtc(to) - toUtc(from)) / 86_400_000);

/** Whether a string is a real calendar date (`2026-02-30` isn't). */
export function isValidDate(date: string | null | undefined): date is string {
  if (!date || !DATE_RE.test(date)) return false;
  return fromUtc(toUtc(date)) === date;
}

/** The local calendar date of an instant, in `timeZone`. */
export function localDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

const firstOfMonth = (date: string) => `${date.slice(0, 7)}-01`;
// Day 0 of the next month is the last day of this one.
const lastOfMonth = (date: string) => fromUtc(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0));
const quarterStart = (date: string) => {
  const month = Number(date.slice(5, 7));
  return `${date.slice(0, 4)}-${String(Math.floor((month - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
};

/**
 * The days a preset means, as of `now` in `timeZone`. `all` runs from `earliest` (the first recorded
 * activity) when given. `custom` takes the visitor's dates, falling back to the last 30 days when they
 * aren't a valid range; the result is always from <= to.
 */
export function resolveRange(preset: RangePreset, now: Date, timeZone: string, options: { custom?: { from?: string | null; to?: string | null }; earliest?: string | null } = {}): DateRange {
  const today = localDate(now.toISOString(), timeZone);
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "7d":
      return { from: addDays(today, -6), to: today };
    case "this_month":
      return { from: firstOfMonth(today), to: today };
    case "last_month": {
      const previousLast = addDays(firstOfMonth(today), -1);
      return { from: firstOfMonth(previousLast), to: previousLast };
    }
    case "this_quarter":
      return { from: quarterStart(today), to: today };
    case "last_quarter": {
      const previousLast = addDays(quarterStart(today), -1);
      return { from: quarterStart(previousLast), to: previousLast };
    }
    case "this_year":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case "12m":
      return { from: addDays(today, -364), to: today };
    case "all":
      return { from: options.earliest && options.earliest <= today ? options.earliest : addDays(today, -29), to: today };
    case "custom": {
      const { from, to } = options.custom ?? {};
      if (isValidDate(from) && isValidDate(to) && from <= to && from >= EARLIEST) return { from, to };
      return { from: addDays(today, -29), to: today };
    }
    case "30d":
    default:
      return { from: addDays(today, -29), to: today };
  }
}

/** The first day of the day, week (Sunday) or month a date falls in. */
export function bucketStart(date: string, by: Granularity): string {
  if (by === "day") return date;
  if (by === "month") return firstOfMonth(date);
  const weekday = new Date(toUtc(date)).getUTCDay(); // 0 = Sunday
  return addDays(date, -weekday);
}

const nextBucket = (start: string, by: Granularity) =>
  by === "day" ? addDays(start, 1) : by === "week" ? addDays(start, 7) : addDays(lastOfMonth(start), 1);

/** How many points a range makes at a granularity. */
export function pointCount(range: DateRange, by: Granularity): number {
  let count = 0;
  for (let start = bucketStart(range.from, by); start <= range.to; start = nextBucket(start, by)) count++;
  return count;
}

/** The granularity actually used: a daily range too long to draw is shown by week. */
export function effectiveGranularity(range: DateRange, by: Granularity): Granularity {
  return by === "day" && pointCount(range, "day") > MAX_POINTS ? "week" : by;
}

/** "Oct 6", "Oct 4" for the week starting then (the table says so), "Oct 2026" for a month. */
export function bucketLabel(start: string, by: Granularity): string {
  const [y, m, d] = start.split("-").map(Number);
  const month = new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return by === "month" ? `${month} ${y}` : `${month} ${d}`;
}

export interface SeriesPoint {
  /** The first day of the bucket. */
  start: string;
  label: string;
  value: number;
  plays: number;
  views: number;
  uniquePlays: number;
  uniqueViewers: number;
  hoursWatched: number;
}

export interface TimeSeries {
  metric: Metric;
  unit: Unit;
  granularity: Granularity;
  range: DateRange;
  points: SeriesPoint[];
  /** The metric over the whole range (not a sum of the points: unique counts and rates don't add). */
  total: number;
}

interface Tally {
  plays: number;
  views: number;
  players: Set<string>;
  viewers: Set<string>;
  watched: number;
}

const emptyTally = (): Tally => ({ plays: 0, views: 0, players: new Set(), viewers: new Set(), watched: 0 });

function valueOf(metric: Metric, t: Tally, durationSeconds: number): number {
  switch (metric) {
    case "total_plays":
      return t.plays;
    case "unique_plays":
      return t.players.size;
    case "unique_viewers":
      return t.viewers.size;
    case "play_rate":
      return t.views > 0 ? t.plays / t.views : 0;
    case "engagement_rate":
      return t.plays > 0 && durationSeconds > 0 ? t.watched / (t.plays * durationSeconds) : 0;
    case "hours_watched":
      return t.watched / 3600;
  }
}

/**
 * One metric over `range`, bucketed by day, week or month, with every bucket in the range present
 * (zero where nothing happened). `sessions` are the video's visits (computePlaySessions); a visit
 * counts on the local day it began, and one with no recorded start is left out.
 */
export function computeTimeSeries(
  sessions: PlaySession[],
  options: { metric: Metric; granularity: Granularity; range: DateRange; timeZone: string; durationSeconds: number },
): TimeSeries {
  const { metric, range, timeZone, durationSeconds } = options;
  const granularity = effectiveGranularity(range, options.granularity);
  const unit = METRICS.find((m) => m.value === metric)?.unit ?? "count";

  const tallies = new Map<string, Tally>();
  for (let start = bucketStart(range.from, granularity); start <= range.to; start = nextBucket(start, granularity)) tallies.set(start, emptyTally());
  const total = emptyTally();

  for (const s of sessions) {
    if (!s.startedAt) continue;
    const day = localDate(s.startedAt, timeZone);
    if (day < range.from || day > range.to) continue;
    for (const t of [tallies.get(bucketStart(day, granularity)), total]) {
      if (!t) continue;
      t.views++;
      t.viewers.add(s.memberId);
      if (s.played) {
        t.plays++;
        t.players.add(s.memberId);
        t.watched += s.watchedSeconds;
      }
    }
  }

  return {
    metric,
    unit,
    granularity,
    range,
    total: valueOf(metric, total, durationSeconds),
    points: [...tallies].map(([start, t]) => ({
      start,
      label: bucketLabel(start, granularity),
      value: valueOf(metric, t, durationSeconds),
      plays: t.plays,
      views: t.views,
      uniquePlays: t.players.size,
      uniqueViewers: t.viewers.size,
      hoursWatched: t.watched / 3600,
    })),
  };
}

const isMetric = (v: string | undefined): v is Metric => METRICS.some((m) => m.value === v);
const isGranularity = (v: string | undefined): v is Granularity => GRANULARITIES.some((g) => g.value === v);
const isPreset = (v: string | undefined): v is RangePreset => RANGES.some((r) => r.value === v);

export interface TimeSeriesQuery {
  metric: Metric;
  granularity: Granularity;
  preset: RangePreset;
  from: string | null;
  to: string | null;
}

/** The chart's controls from a page's search params; anything unrecognised falls back to the default (total plays, by day, last 30 days). */
export function parseTimeSeriesQuery(params: { metric?: string; by?: string; range?: string; from?: string; to?: string }): TimeSeriesQuery {
  return {
    metric: isMetric(params.metric) ? params.metric : "total_plays",
    granularity: isGranularity(params.by) ? params.by : "day",
    preset: isPreset(params.range) ? params.range : "30d",
    from: isValidDate(params.from) ? params.from : null,
    to: isValidDate(params.to) ? params.to : null,
  };
}

/** The value for display: "42", "63%", "1.5 h". */
export function formatMetricValue(value: number, unit: Unit): string {
  if (unit === "percent") return `${Math.round(value * 100)}%`;
  if (unit === "hours") return value >= 10 ? `${Math.round(value)} h` : `${(Math.round(value * 10) / 10).toFixed(1)} h`;
  return String(Math.round(value));
}
