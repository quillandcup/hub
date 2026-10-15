import GoalProgressBar from "./GoalProgressBar";
import HabitGoalCard from "./HabitGoalCard";
import type { GoalRow } from "@/app/(member)/projects/actions";

/** Renders a goal's title/description, then a target goal's progress bar or a habit goal's streak card, based on `goal.kind`. */
export default function GoalDisplay({ goal }: { goal: GoalRow }) {
  return (
    <div>
      {goal.title && <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{goal.title}</p>}
      {goal.description && (
        <p className="text-xs italic text-slate-500 dark:text-slate-400 mb-1 whitespace-pre-line">{goal.description}</p>
      )}
      {goal.kind === "habit" ? (
        <HabitGoalCard
          measure={goal.measure}
          habitPeriod={goal.habitPeriod}
          habitThreshold={goal.habitThreshold}
          currentStreak={goal.currentStreak}
          longestStreak={goal.longestStreak}
          typicalStreak={goal.typicalStreak}
          hitRatePercent={goal.hitRatePercent}
        />
      ) : (
        <GoalProgressBar
          measure={goal.measure}
          current={goal.current}
          target={goal.targetAmount}
          percent={goal.percent}
          parTarget={goal.parTarget}
          onPace={goal.onPace}
          status={goal.status}
          endDate={goal.endDate}
        />
      )}
    </div>
  );
}
