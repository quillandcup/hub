import GoalProgressBar from "./GoalProgressBar";
import HabitGoalCard from "./HabitGoalCard";
import type { GoalRow } from "@/app/(member)/projects/actions";

/** Renders a target goal's progress bar or a habit goal's streak card, based on `goal.kind`. */
export default function GoalDisplay({ goal }: { goal: GoalRow }) {
  if (goal.kind === "habit") {
    return (
      <HabitGoalCard
        measure={goal.measure}
        habitPeriod={goal.habitPeriod}
        habitThreshold={goal.habitThreshold}
        currentStreak={goal.currentStreak}
        longestStreak={goal.longestStreak}
        typicalStreak={goal.typicalStreak}
        hitRatePercent={goal.hitRatePercent}
        anchorLabel={goal.anchorLabel}
      />
    );
  }

  return (
    <GoalProgressBar
      measure={goal.measure}
      current={goal.current}
      target={goal.targetAmount}
      percent={goal.percent}
      parTarget={goal.parTarget}
      onPace={goal.onPace}
    />
  );
}
