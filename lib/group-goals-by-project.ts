export interface GoalGroup<T> {
  projectId: string;
  projectTitle: string;
  goals: T[];
}

/**
 * Groups goals that are already in order (by project, then by goal) so each project's title shows once.
 *
 * Only goals that sit next to each other and share a project are merged; the list is never re-sorted. The caller's
 * order (`getStarredGoals`: the member's project order, then their goal order) already keeps a project's goals together,
 * so that is every goal of a project. If a list ever did have the same project twice apart, it would show as two
 * groups in the order it came, which is honest about the order it was given rather than silently moving a goal.
 */
export function groupConsecutiveByProject<T extends { projectId: string; projectTitle: string }>(goals: T[]): GoalGroup<T>[] {
  const groups: GoalGroup<T>[] = [];
  for (const goal of goals) {
    const last = groups[groups.length - 1];
    if (last && last.projectId === goal.projectId) last.goals.push(goal);
    else groups.push({ projectId: goal.projectId, projectTitle: goal.projectTitle, goals: [goal] });
  }
  return groups;
}
