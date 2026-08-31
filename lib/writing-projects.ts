export type WritingMeasure = "prickles" | "words" | "time_minutes" | "pages" | "chapters" | "scenes" | "lines";
export type EntryMode = "delta" | "set_total";

export const WRITING_MEASURES: WritingMeasure[] = [
  "prickles",
  "words",
  "time_minutes",
  "pages",
  "chapters",
  "scenes",
  "lines",
];

export const MEASURE_LABELS: Record<WritingMeasure, string> = {
  prickles: "Prickles attended",
  words: "Words",
  time_minutes: "Time (minutes)",
  pages: "Pages",
  chapters: "Chapters",
  scenes: "Scenes",
  lines: "Lines",
};

export interface ProgressEntryInput {
  entryDate: string; // YYYY-MM-DD
  createdAt: string; // ISO timestamp, tiebreaker for same-day entries
  mode: EntryMode;
  amount: number;
}

/**
 * Replays entries in (entryDate, createdAt) order -- not insertion order -- so a backdated entry
 * recomputes the total correctly. A 'set_total' entry resets the running total to `amount` as of
 * that entry; a 'delta' entry adds `amount` to whatever the running total was at that point.
 */
export function computeCumulativeTotal(entries: ProgressEntryInput[]): number {
  const sorted = [...entries].sort(compareByDateThenCreatedAt);
  let running = 0;
  for (const entry of sorted) {
    running = entry.mode === "set_total" ? entry.amount : running + entry.amount;
  }
  return running;
}

/**
 * Same replay as computeCumulativeTotal, but returns the running total as of each date
 * (chronological order) -- for a cumulative chart. Multiple entries on the same date collapse
 * into a single point holding that day's final total, since a per-date chart axis can't
 * usefully distinguish same-day points anyway.
 */
export function computeCumulativeSeries(
  entries: ProgressEntryInput[]
): { entryDate: string; total: number }[] {
  const sorted = [...entries].sort(compareByDateThenCreatedAt);
  let running = 0;
  const byDate = new Map<string, number>();
  for (const entry of sorted) {
    running = entry.mode === "set_total" ? entry.amount : running + entry.amount;
    byDate.set(entry.entryDate, running);
  }
  return [...byDate.entries()].map(([entryDate, total]) => ({ entryDate, total }));
}

function compareByDateThenCreatedAt(a: ProgressEntryInput, b: ProgressEntryInput): number {
  if (a.entryDate !== b.entryDate) return a.entryDate < b.entryDate ? -1 : 1;
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

export interface GoalProgressInput {
  entries: ProgressEntryInput[]; // already filtered to this goal's measure (and project, if scoped)
  targetAmount: number;
  startDate: string | null; // YYYY-MM-DD
  endDate: string | null; // YYYY-MM-DD
  now: Date;
}

export interface GoalProgress {
  current: number;
  target: number;
  percent: number; // 0-100+, current/target
  /** Pace needed-to-date to finish on time, or null if the goal has no end date (nothing to pace against). */
  parTarget: number | null;
  /** True if current >= parTarget; null when parTarget is null. */
  onPace: boolean | null;
}

/**
 * Only counts entries within [startDate, endDate] (inclusive, either bound optional) -- a goal
 * measures progress made toward it, not a project's all-time total. parTarget is target_amount
 * scaled by elapsed/total days in the window, clamped to [0, target_amount].
 */
export function computeGoalProgress(input: GoalProgressInput): GoalProgress {
  const { entries, targetAmount, startDate, endDate, now } = input;

  const inWindow = entries.filter(
    (e) => (!startDate || e.entryDate >= startDate) && (!endDate || e.entryDate <= endDate)
  );
  const current = computeCumulativeTotal(inWindow);
  const percent = targetAmount > 0 ? (current / targetAmount) * 100 : 0;

  let parTarget: number | null = null;
  if (endDate && startDate) {
    const totalDays = daysBetween(startDate, endDate);
    const elapsedDays = daysBetween(startDate, isoDate(now));
    const fraction = totalDays <= 0 ? 1 : Math.min(1, Math.max(0, elapsedDays / totalDays));
    parTarget = targetAmount * fraction;
  }

  return {
    current,
    target: targetAmount,
    percent,
    parTarget,
    onPace: parTarget === null ? null : current >= parTarget,
  };
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00Z`).getTime();
  const to = new Date(`${toIso}T00:00:00Z`).getTime();
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export interface PrickleAttendanceRow {
  typeId: string;
  hostId: string | null;
  localDate: string; // YYYY-MM-DD, already resolved to the member's local calendar date
}

/** A prickles-measure goal's frozen anchor snapshot (see writing_goals.anchor_* columns) -- never a live prickle_schedules lookup. */
export interface PrickleGoalAnchor {
  typeId: string | null;
  hostId: string | null;
  dayOfWeek: number | null; // 0=Sunday..6=Saturday
}

function localDateDayOfWeek(localDate: string): number {
  return new Date(`${localDate}T00:00:00Z`).getUTCDay();
}

/**
 * Filters a member's prickle attendance down to what a prickles-measure habit goal should
 * count, then groups by date -- output feeds directly into computeHabitGoalProgress unchanged.
 * Each anchor field applies independently when set; all three null means "any (writing-purpose)
 * prickle attended counts" -- purpose filtering itself happens upstream, at the query that
 * produces `attendance` (see getMyPrickleAttendance), not here.
 */
export function derivePrickleHabitEntries(
  attendance: PrickleAttendanceRow[],
  anchor: PrickleGoalAnchor
): { entryDate: string; amount: number }[] {
  const matching = attendance.filter((row) => {
    if (anchor.typeId != null && row.typeId !== anchor.typeId) return false;
    if (anchor.hostId != null && row.hostId !== anchor.hostId) return false;
    if (anchor.dayOfWeek != null && localDateDayOfWeek(row.localDate) !== anchor.dayOfWeek) return false;
    return true;
  });

  const totalsByDate = new Map<string, number>();
  for (const row of matching) {
    totalsByDate.set(row.localDate, (totalsByDate.get(row.localDate) ?? 0) + 1);
  }

  return [...totalsByDate.entries()].map(([entryDate, amount]) => ({ entryDate, amount }));
}

export type HabitPeriod = "day" | "week" | "month";

export interface HabitProgressInput {
  entries: { entryDate: string; amount: number }[]; // already filtered to this goal's measure (and project, if scoped)
  period: HabitPeriod;
  /** null means "logged something counts" -- any activity in the period is a hit. */
  threshold: number | null;
  now: Date;
}

export interface HabitProgress {
  currentStreak: number;
  longestStreak: number;
  /** Average length of completed hit-runs (mirrors TrackBear's "typical streak length"). */
  typicalStreak: number;
  /** Hit periods / periods tracked (from the first-ever entry's period through the current period), 0-100. */
  hitRatePercent: number;
}

/** Monday-start week index / day index / month index -- an integer that increments by exactly 1 per period, so consecutive periods differ by 1 regardless of period type. */
function periodIndex(entryDateIso: string, period: HabitPeriod): number {
  const [y, m, d] = entryDateIso.split("-").map(Number);
  const utcMs = Date.UTC(y, m - 1, d);
  if (period === "month") return y * 12 + (m - 1);
  if (period === "day") return Math.floor(utcMs / (24 * 60 * 60 * 1000));

  // week: normalize to that week's Monday before indexing, so any day in the
  // same ISO week maps to the same index.
  const date = new Date(utcMs);
  const dayOfWeek = date.getUTCDay();
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  date.setUTCDate(date.getUTCDate() - daysToMonday);
  return Math.floor(date.getTime() / (7 * 24 * 60 * 60 * 1000));
}

/**
 * A period is a "hit" if its total logged amount meets the threshold (or, with no threshold, if
 * anything was logged at all). Per-period totals sum every entry's `amount` at face value
 * (delta and set_total alike) -- unlike the project's all-time cumulative total, a habit period
 * asks "how much did they log this period," not "what's the running total," so set_total's
 * replace-the-total semantics don't apply here.
 */
export function computeHabitGoalProgress(input: HabitProgressInput): HabitProgress {
  const { entries, period, threshold, now } = input;
  const empty: HabitProgress = { currentStreak: 0, longestStreak: 0, typicalStreak: 0, hitRatePercent: 0 };
  if (entries.length === 0) return empty;

  const totalsByPeriod = new Map<number, number>();
  for (const e of entries) {
    const idx = periodIndex(e.entryDate, period);
    totalsByPeriod.set(idx, (totalsByPeriod.get(idx) ?? 0) + e.amount);
  }

  const hitPeriods = [...totalsByPeriod.entries()]
    .filter(([, total]) => (threshold == null ? true : total >= threshold))
    .map(([idx]) => idx)
    .sort((a, b) => a - b);
  if (hitPeriods.length === 0) return empty;

  const runs: number[] = [];
  let runLength = 1;
  for (let i = 1; i < hitPeriods.length; i++) {
    if (hitPeriods[i] === hitPeriods[i - 1] + 1) {
      runLength++;
    } else {
      runs.push(runLength);
      runLength = 1;
    }
  }
  runs.push(runLength);

  const longestStreak = Math.max(...runs);
  const typicalStreak = runs.reduce((a, b) => a + b, 0) / runs.length;

  const currentPeriod = periodIndex(isoDate(now), period);
  const lastHitPeriod = hitPeriods[hitPeriods.length - 1];
  // The current period isn't over yet, so being one period behind (haven't logged
  // this period yet, but did last period) doesn't break the streak -- same grace
  // window as lib/streaks.ts's attendance-streak logic.
  const currentStreak = lastHitPeriod >= currentPeriod - 1 ? runs[runs.length - 1] : 0;

  const firstPeriod = Math.min(...totalsByPeriod.keys());
  const periodsTracked = currentPeriod - firstPeriod + 1;
  const hitRatePercent = (hitPeriods.length / periodsTracked) * 100;

  return { currentStreak, longestStreak, typicalStreak, hitRatePercent };
}
