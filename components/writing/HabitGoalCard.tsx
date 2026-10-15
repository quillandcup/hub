import { MEASURE_LABELS, type WritingMeasure, type HabitPeriod } from "@/lib/writing-projects";

interface HabitGoalCardProps {
  measure: WritingMeasure;
  habitPeriod: HabitPeriod;
  habitThreshold: number | null;
  currentStreak: number;
  longestStreak: number;
  typicalStreak: number;
  hitRatePercent: number;
}

const PERIOD_LABELS: Record<HabitPeriod, string> = { day: "day", week: "week", month: "month" };

export default function HabitGoalCard({
  measure,
  habitPeriod,
  habitThreshold,
  currentStreak,
  longestStreak,
  typicalStreak,
  hitRatePercent,
}: HabitGoalCardProps) {
  const periodLabel = PERIOD_LABELS[habitPeriod];
  const goalText = habitThreshold
    ? `${habitThreshold.toLocaleString()} ${MEASURE_LABELS[measure].toLowerCase()} / ${periodLabel}`
    : `Log something every ${periodLabel}`;

  return (
    <div>
      <p className="text-sm text-slate-600 dark:text-slate-400">{goalText}</p>
      <div className="flex flex-wrap gap-x-6 gap-y-1 mt-2 text-sm">
        <span className="flex items-center gap-1">
          <span aria-hidden>🔥</span>
          <strong className="text-slate-900 dark:text-slate-100">{currentStreak}</strong>
          <span className="text-slate-500 dark:text-slate-400">{periodLabel} streak</span>
        </span>
        <span className="text-slate-500 dark:text-slate-400">
          Longest: <strong className="text-slate-900 dark:text-slate-100">{longestStreak}</strong>
        </span>
        <span className="text-slate-500 dark:text-slate-400">
          Typical: <strong className="text-slate-900 dark:text-slate-100">{typicalStreak.toFixed(1)}</strong>
        </span>
        <span className="text-slate-500 dark:text-slate-400">
          Hit rate: <strong className="text-slate-900 dark:text-slate-100">{Math.round(hitRatePercent)}%</strong>
        </span>
      </div>
    </div>
  );
}
