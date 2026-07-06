import { describe, it, expect } from 'vitest';
import { computeOverlapLayout } from '@/lib/calendar-overlap';

function item(id: string, startIso: string, endIso: string) {
  return { id, start_time: startIso, end_time: endIso };
}

describe('computeOverlapLayout', () => {
  it('returns empty map for no items', () => {
    expect(computeOverlapLayout([])).toEqual(new Map());
  });

  it('single item gets colIndex 0 and colCount 1', () => {
    const result = computeOverlapLayout([item('a', '2026-06-18T19:00:00Z', '2026-06-18T20:00:00Z')]);
    expect(result.get('a')).toEqual({ colIndex: 0, colCount: 1 });
  });

  it('two non-overlapping items each get colCount 1', () => {
    const result = computeOverlapLayout([
      item('a', '2026-06-18T19:00:00Z', '2026-06-18T20:00:00Z'),
      item('b', '2026-06-18T20:00:00Z', '2026-06-18T21:00:00Z'), // starts exactly when a ends
    ]);
    expect(result.get('a')).toEqual({ colIndex: 0, colCount: 1 });
    expect(result.get('b')).toEqual({ colIndex: 0, colCount: 1 });
  });

  it('two fully overlapping items (same time) get colCount 2 and different colIndex', () => {
    // Regression case: Heads Down + Readers' Club Prickle both at 2026-06-19T00:00:00Z
    const result = computeOverlapLayout([
      item('heads-down',    '2026-06-19T00:00:00Z', '2026-06-19T01:00:00Z'),
      item('readers-club',  '2026-06-19T00:00:00Z', '2026-06-19T01:00:00Z'),
    ]);
    const a = result.get('heads-down')!;
    const b = result.get('readers-club')!;
    expect(a.colCount).toBe(2);
    expect(b.colCount).toBe(2);
    expect(a.colIndex).not.toBe(b.colIndex);
    expect(new Set([a.colIndex, b.colIndex])).toEqual(new Set([0, 1]));
  });

  it('two partially overlapping items get colCount 2 during overlap', () => {
    const result = computeOverlapLayout([
      item('a', '2026-06-18T19:00:00Z', '2026-06-18T20:30:00Z'),
      item('b', '2026-06-18T20:00:00Z', '2026-06-18T21:00:00Z'),
    ]);
    expect(result.get('a')!.colCount).toBe(2);
    expect(result.get('b')!.colCount).toBe(2);
    expect(result.get('a')!.colIndex).not.toBe(result.get('b')!.colIndex);
  });

  it('three concurrent items get colCount 3 and distinct colIndexes', () => {
    const result = computeOverlapLayout([
      item('a', '2026-06-18T19:00:00Z', '2026-06-18T20:00:00Z'),
      item('b', '2026-06-18T19:00:00Z', '2026-06-18T20:00:00Z'),
      item('c', '2026-06-18T19:00:00Z', '2026-06-18T20:00:00Z'),
    ]);
    const indexes = ['a', 'b', 'c'].map(id => result.get(id)!.colIndex);
    const counts  = ['a', 'b', 'c'].map(id => result.get(id)!.colCount);
    expect(new Set(indexes)).toEqual(new Set([0, 1, 2]));
    expect(counts).toEqual([3, 3, 3]);
  });

  it('items in separate non-overlapping groups are laid out independently', () => {
    const result = computeOverlapLayout([
      item('a', '2026-06-18T09:00:00Z', '2026-06-18T10:00:00Z'),
      item('b', '2026-06-18T09:00:00Z', '2026-06-18T10:00:00Z'), // overlaps a
      item('c', '2026-06-18T14:00:00Z', '2026-06-18T15:00:00Z'), // separate group
    ]);
    expect(result.get('a')!.colCount).toBe(2);
    expect(result.get('b')!.colCount).toBe(2);
    expect(result.get('c')).toEqual({ colIndex: 0, colCount: 1 });
  });
});
