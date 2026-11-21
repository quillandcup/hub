export interface OverlapItem {
  id: string;
  start_time: string;
  end_time: string;
}

export interface OverlapLayout {
  colIndex: number;
  colCount: number;
}

/**
 * Assigns each item a column index within its overlap group so overlapping
 * events can be rendered side by side rather than stacked.
 *
 * Returns a Map from item id → { colIndex, colCount }.
 * colCount is the number of concurrent columns needed during that item's slot.
 */
export function computeOverlapLayout(items: OverlapItem[]): Map<string, OverlapLayout> {
  const result = new Map<string, OverlapLayout>();
  if (items.length === 0) return result;

  const sorted = items
    .map(p => ({ id: p.id, start: new Date(p.start_time).getTime(), end: new Date(p.end_time).getTime() }))
    .sort((a, b) => a.start - b.start);

  // Greedy column assignment: place each item in the first column it fits
  const colEnds: number[] = [];
  const colOf = new Map<string, number>();
  for (const { id, start, end } of sorted) {
    const col = colEnds.findIndex(t => t <= start);
    if (col === -1) { colOf.set(id, colEnds.length); colEnds.push(end); }
    else            { colOf.set(id, col);             colEnds[col] = end; }
  }

  // colCount = highest column index among all items that overlap this one, plus 1
  for (const { id, start, end } of sorted) {
    const overlapping = sorted.filter(o => o.start < end && o.end > start);
    const colCount = Math.max(...overlapping.map(o => colOf.get(o.id) ?? 0)) + 1;
    result.set(id, { colIndex: colOf.get(id) ?? 0, colCount });
  }
  return result;
}
