import type { ActionMenuItem } from "@/components/ActionMenu";

/** Pure helpers for reordering a list of ids: the course builder and the member's project list share them. */

/** `ids` with `id` moved to where `before` is (dropped onto it). Unchanged for an id that isn't there or is dropped on itself. */
export function moveBefore(ids: string[], id: string, before: string): string[] {
  if (id === before || !ids.includes(id) || !ids.includes(before)) return ids;
  const without = ids.filter((x) => x !== id);
  without.splice(without.indexOf(before), 0, id);
  return without;
}

/** `ids` with `id` moved to a 1-based position (clamped to the list); unchanged for an id that isn't there or is already there. */
export function moveToPosition(ids: string[], id: string, position: number): string[] {
  const from = ids.indexOf(id);
  const to = Math.min(Math.max(position, 1), ids.length) - 1;
  if (from === -1 || from === to) return ids;
  const next = ids.filter((x) => x !== id);
  next.splice(to, 0, id);
  return next;
}

/**
 * The "Move to position" menu items for the row at 0-based `index` of `count`: one per place, the current one shown
 * as `Position N (current)` and off. The heading to give the menu is `positionsHeading(count)`. Shared by the writing
 * lists and the course builder outline, so both read the same.
 */
export function positionItems(count: number, index: number, onMoveTo: (position: number) => void, track: string): ActionMenuItem[] {
  return Array.from({ length: count }, (_, i) => ({
    key: `pos-${i + 1}`,
    label: i === index ? `Position ${i + 1} (current)` : `Move to position ${i + 1}`,
    disabled: i === index,
    track,
    onSelect: () => onMoveTo(i + 1),
  }));
}

export const positionsHeading = (count: number) => `Move to position (of ${count})`;
