import { MEASURE_LABELS, type WritingMeasure } from "@/lib/writing-projects";

interface GoalProgressBarProps {
  measure: WritingMeasure;
  current: number;
  target: number;
  percent: number;
  parTarget: number | null;
  onPace: boolean | null;
  status?: "active" | "achieved" | "ended";
  endDate?: string | null;
  /** Set when the goal counts only a date window: the project's all-time total is shown beneath. */
  projectTotal?: number | null;
  /** Set when `current` includes the project's starting balance. */
  includesStartingBalance?: boolean;
  /** The goal's start date: with one, only progress logged since then counts. */
  startDate?: string | null;
}

export default function GoalProgressBar({
  measure,
  current,
  target,
  percent,
  parTarget,
  onPace,
  status = "active",
  endDate = null,
  projectTotal = null,
  includesStartingBalance = false,
  startDate = null,
}: GoalProgressBarProps) {
  const clampedPercent = Math.min(100, Math.max(0, percent));
  // Pace only matters while the goal is running.
  const isActive = status === "active";
  // A goal that ended unmet reads as a fact, not a score: no percentage, and the bar is dropped.
  const isEnded = status === "ended";
  const parPercent =
    isActive && parTarget !== null && target > 0 ? Math.min(100, Math.max(0, (parTarget / target) * 100)) : null;

  const barColor =
    status === "achieved"
      ? "bg-emerald-600"
      : status === "ended"
        ? "bg-slate-400 dark:bg-slate-500"
        : onPace === false
          ? "bg-amber-500"
          : "bg-plum-600";

  return (
    <div>
      <div className="flex items-baseline justify-between text-sm mb-1">
        <span className="text-slate-600 dark:text-slate-400">
          {current.toLocaleString()} / {target.toLocaleString()} {MEASURE_LABELS[measure].toLowerCase()}
          {endDate && !isEnded && <span className="text-slate-500 dark:text-slate-400"> by {endDate}</span>}
        </span>
        {!isEnded && <span className="text-slate-500 dark:text-slate-400 text-xs">{Math.round(percent)}%</span>}
      </div>
      {!isEnded && (
        <div className="relative h-2.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
          <div className={`absolute inset-y-0 left-0 rounded-full ${barColor}`} style={{ width: `${clampedPercent}%` }} />
          {parPercent !== null && (
            <div
              className="absolute inset-y-0 w-0.5 bg-slate-900 dark:bg-slate-100"
              style={{ left: `${parPercent}%` }}
              title="Pace needed to finish on time"
            />
          )}
        </div>
      )}
      {includesStartingBalance && (
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Includes your starting balance.</p>
      )}
      {startDate && (
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Counts progress logged since {startDate}
          {projectTotal !== null && projectTotal !== current && (
            <>
              . Project total: {projectTotal.toLocaleString()} {MEASURE_LABELS[measure].toLowerCase()}
            </>
          )}
        </p>
      )}
      {status === "achieved" ? (
        <p className="mt-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">Achieved!</p>
      ) : status === "ended" ? (
        <p className="text-xs text-slate-600 dark:text-slate-400">{endDate ? `Ended ${endDate}` : "Ended"}</p>
      ) : (
        onPace !== null && (
          <p className={`mt-1 text-xs ${onPace ? "text-plum-600 dark:text-plum-400" : "text-amber-600 dark:text-amber-400"}`}>
            {onPace ? "On pace" : "Behind pace"}
          </p>
        )
      )}
    </div>
  );
}
