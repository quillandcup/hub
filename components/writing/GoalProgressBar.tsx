import { MEASURE_LABELS, type WritingMeasure } from "@/lib/writing-projects";

interface GoalProgressBarProps {
  measure: WritingMeasure;
  current: number;
  target: number;
  percent: number;
  parTarget: number | null;
  onPace: boolean | null;
}

export default function GoalProgressBar({ measure, current, target, percent, parTarget, onPace }: GoalProgressBarProps) {
  const clampedPercent = Math.min(100, Math.max(0, percent));
  const parPercent = parTarget !== null && target > 0 ? Math.min(100, Math.max(0, (parTarget / target) * 100)) : null;

  const barColor = onPace === false ? "bg-amber-500" : "bg-blue-600";

  return (
    <div>
      <div className="flex items-baseline justify-between text-sm mb-1">
        <span className="text-slate-600 dark:text-slate-400">
          {current.toLocaleString()} / {target.toLocaleString()} {MEASURE_LABELS[measure].toLowerCase()}
        </span>
        <span className="text-slate-400 text-xs">{Math.round(percent)}%</span>
      </div>
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
      {onPace !== null && (
        <p className={`mt-1 text-xs ${onPace ? "text-blue-600 dark:text-blue-400" : "text-amber-600 dark:text-amber-400"}`}>
          {onPace ? "On pace" : "Behind pace"}
        </p>
      )}
    </div>
  );
}
