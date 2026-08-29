export type WritingMeasure = "words" | "time_minutes" | "pages" | "chapters" | "scenes" | "lines";
export type EntryMode = "delta" | "set_total";

export const WRITING_MEASURES: WritingMeasure[] = [
  "words",
  "time_minutes",
  "pages",
  "chapters",
  "scenes",
  "lines",
];

export const MEASURE_LABELS: Record<WritingMeasure, string> = {
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

/** Same replay as computeCumulativeTotal, but returns the running total after each entry (chronological order) -- for a cumulative chart. */
export function computeCumulativeSeries(
  entries: ProgressEntryInput[]
): { entryDate: string; total: number }[] {
  const sorted = [...entries].sort(compareByDateThenCreatedAt);
  let running = 0;
  return sorted.map((entry) => {
    running = entry.mode === "set_total" ? entry.amount : running + entry.amount;
    return { entryDate: entry.entryDate, total: running };
  });
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
