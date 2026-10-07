/**
 * Split [from, to] into consecutive windows of at most `days` days, for
 * rebuilds that would run past Postgres's statement timeout as one call.
 *
 * Windows are inclusive at both ends (the reprocess functions use
 * `>= from AND <= to`), so each one ends a millisecond before the next
 * starts. Slack and Zoom timestamps are stored to the millisecond, so no row
 * falls between two windows and none is in both.
 */
export function splitIntoWindows(from: Date, to: Date, days: number): { from: Date; to: Date }[] {
  const windows: { from: Date; to: Date }[] = [];
  const stepMs = days * 24 * 60 * 60 * 1000;
  if (!(stepMs > 0) || to.getTime() < from.getTime()) return [{ from, to }];

  for (let start = from.getTime(); start <= to.getTime(); start += stepMs) {
    const end = Math.min(start + stepMs - 1, to.getTime());
    windows.push({ from: new Date(start), to: new Date(end) });
  }
  return windows;
}
