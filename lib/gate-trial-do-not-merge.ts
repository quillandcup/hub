// Throwaway file for a trial PR that must never merge: it checks that the "Code quality gate" job goes red on
// two identical functions. Delete the branch with the PR.
export function trialDoubleA(value: number): number {
  const next = value + 1;
  if (next > 2) {
    return next * 2;
  }
  return next;
}

export function trialDoubleB(value: number): number {
  const next = value + 1;
  if (next > 2) {
    return next * 2;
  }
  return next;
}
