import { ORG_TIMEZONE } from "@/lib/config";
import type { AttendanceRepository, AttendanceStay } from "@/lib/data/attendance";
import type { BookRepository } from "@/lib/data/books";
import type { WordsLogged, WritingRepository } from "@/lib/data/writing";
import { zonedLocalToUtc } from "./countdown";

/**
 * The live figures a landing page can show (docs/product/LANDING_PAGES.md, "Live data"). One registry entry per figure: the key a
 * block stores, the label the editor's list shows, the caption it gets when the editor leaves the label empty, which
 * data it needs and how it turns that into a number. Adding a figure is one entry here (and a test).
 *
 * Privacy: counts and sums only. The inputs name members so a figure can count distinct writers, and nothing that
 * leaves this file does. Days are Eastern days (`ORG_TIMEZONE`), never the server's.
 */

const HOUR = 3_600_000;

/** What the figures are computed from, loaded once for however many figures a page asks for. */
export type LiveStatInputs = {
  /** Attendance records that began in the trailing 30 days. */
  stays: AttendanceStay[];
  /** Words logged as additions on the trailing 30 days (entry dates). */
  words: WordsLogged[];
  /** Live books published so far, all time (a count; no titles or authors). */
  books: number;
  /** The instant the windows end at, and the first instant of the trailing 7 and 30 Eastern days. */
  now: number;
  since7: number;
  since30: number;
};

export type LiveStatDefinition = {
  /** Shown in the editor's list. */
  label: string;
  /** The line under the figure when the editor leaves the label empty. Says what is counted and over what. */
  caption: string;
  needs: "stays" | "words" | "books";
  /** The raw number, or null when there is nothing to show. */
  compute: (inputs: LiveStatInputs) => number | null;
};

/** Hours of one stay inside its prickle's own window: Zoom can stay open after a prickle ends, and a join can come before it starts. */
export function clippedHours(stay: AttendanceStay): number {
  const from = Math.max(Date.parse(stay.joinTime), Date.parse(stay.prickleStart));
  const to = Math.min(Date.parse(stay.leaveTime), Date.parse(stay.prickleEnd));
  return Number.isFinite(from) && Number.isFinite(to) && to > from ? (to - from) / HOUR : 0;
}

export const LIVE_STATS = {
  hours_30d: {
    label: "Hours written together in prickles (last 30 days)",
    caption: "hours written together in prickles in the last 30 days",
    needs: "stays",
    compute: ({ stays }) => stays.reduce((sum, s) => sum + clippedHours(s), 0),
  },
  prickles_30d: {
    label: "Prickles with writers in them (last 30 days)",
    caption: "prickles with writers in them in the last 30 days",
    needs: "stays",
    compute: ({ stays }) => new Set(stays.map((s) => s.prickleId)).size,
  },
  writers_7d: {
    label: "Writers who joined a prickle (last 7 days)",
    caption: "writers joined a prickle in the last 7 days",
    needs: "stays",
    compute: ({ stays, since7 }) => new Set(stays.filter((s) => Date.parse(s.joinTime) >= since7).map((s) => s.memberId)).size,
  },
  words_30d: {
    label: "Words logged in the Hub (last 30 days)",
    caption: "words logged by members in the Hub in the last 30 days",
    needs: "words",
    // Only additions (`delta`), never a project's running total; a correction below zero can't make the sum negative.
    compute: ({ words }) => Math.max(0, words.reduce((sum, w) => sum + (Number.isFinite(w.amount) ? w.amount : 0), 0)),
  },
  books_published: {
    label: "Books published by members (all time)",
    caption: "books published by members",
    needs: "books",
    // Books members put on the Bookshelf whose publish date has come; a book still to be released is not counted, and a book nobody added is not known.
    compute: ({ books }) => books,
  },
} as const satisfies Record<string, LiveStatDefinition>;

export type LiveStatKey = keyof typeof LIVE_STATS;
export const LIVE_STAT_KEYS = Object.keys(LIVE_STATS) as LiveStatKey[];
export const isLiveStatKey = (value: unknown): value is LiveStatKey => typeof value === "string" && Object.hasOwn(LIVE_STATS, value);

/** The editor's list: every figure, by its label. */
export const LIVE_STAT_OPTIONS = LIVE_STAT_KEYS.map((key) => ({ label: LIVE_STATS[key].label, value: key }));

/**
 * A figure for display that never overstates: under 100 exactly, from 100 floored to two significant digits with a plus
 * when something was cut off ("890+" for 891, "54,000+" for 54,700, "900" for exactly 900).
 */
export function friendlyFloor(value: number): string {
  const n = Math.floor(value);
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 100) return String(n);
  const unit = 10 ** (String(n).length - 2);
  const floored = Math.floor(n / unit) * unit;
  return `${floored.toLocaleString("en-US")}${floored < n ? "+" : ""}`;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** YYYY-MM-DD of the Eastern day `daysBack` days before the day `now` falls on. */
export function easternDay(now: number, daysBack: number): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: ORG_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
  const [y, m, d] = today.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d - daysBack));
  return `${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}`;
}

/** The first instant of the Eastern day `daysBack` days ago (a day is 23 or 25 hours long when the clocks change, which is why this goes through the zone and not 24-hour steps). */
export function easternDayStart(now: number, daysBack: number): number {
  const iso = zonedLocalToUtc(`${easternDay(now, daysBack)}T00:00`, ORG_TIMEZONE);
  return iso ? Date.parse(iso) : now - (daysBack + 1) * 24 * HOUR;
}

export type LiveStatValue = { value: string; caption: string };

type LiveStatRepos = { attendance: Pick<AttendanceRepository, "staysJoinedBetween">; writing: Pick<WritingRepository, "wordsLoggedBetween">; books: Pick<BookRepository, "countPublishedOnOrBefore"> };

/**
 * The figures asked for, each formatted, loaded with one pass over what they need (so three figures from attendance cost one
 * query). A figure with nothing to show (zero, or no data) is left out, and the block shows what was typed. A failure throws:
 * the caller catches it and falls back to the typed values.
 */
export async function loadLiveStats(repos: LiveStatRepos, keys: readonly string[], nowDate: Date): Promise<Record<string, LiveStatValue>> {
  const wanted = [...new Set(keys.filter(isLiveStatKey))];
  if (wanted.length === 0) return {};
  const now = nowDate.getTime();
  const since7 = easternDayStart(now, 6);
  const since30 = easternDayStart(now, 29);
  const needs = new Set(wanted.map((k) => LIVE_STATS[k].needs));
  const [stays, words, books] = await Promise.all([
    needs.has("stays") ? repos.attendance.staysJoinedBetween(new Date(since30).toISOString(), nowDate.toISOString()) : Promise.resolve([]),
    needs.has("words") ? repos.writing.wordsLoggedBetween(easternDay(now, 29), easternDay(now, 0)) : Promise.resolve([]),
    needs.has("books") ? repos.books.countPublishedOnOrBefore(easternDay(now, 0)) : Promise.resolve(0),
  ]);
  const inputs: LiveStatInputs = { stays, words, books, now, since7, since30 };
  const out: Record<string, LiveStatValue> = {};
  for (const key of wanted) {
    const value = LIVE_STATS[key].compute(inputs);
    if (value !== null && Math.floor(value) > 0) out[key] = { value: friendlyFloor(value), caption: LIVE_STATS[key].caption };
  }
  return out;
}
