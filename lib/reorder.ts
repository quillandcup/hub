/** Pure helpers for reordering a list of ids: the course builder and the member's project list share them. */

/** `ids` with `id` moved to where `before` is (dropped onto it). Unchanged for an id that isn't there or is dropped on itself. */
export function moveBefore(ids: string[], id: string, before: string): string[] {
  if (id === before || !ids.includes(id) || !ids.includes(before)) return ids;
  const without = ids.filter((x) => x !== id);
  without.splice(without.indexOf(before), 0, id);
  return without;
}

/** `ids` with `id` moved one place up (delta -1) or down (+1); unchanged at either end. */
export function moveBy(ids: string[], id: string, delta: -1 | 1): string[] {
  const from = ids.indexOf(id);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= ids.length) return ids;
  const next = [...ids];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}
