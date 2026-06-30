import { describe, it, expect } from 'vitest';
import { computeScheduledPrickleStats } from '@/lib/scheduled-prickle-stats';

const t1 = { id: 't1', name: 'Heads Down' };
const t2 = { id: 't2', name: 'Open Table' };

function prickle(id: string, typeId: string, date: string) {
  return { id, type_id: typeId, start_time: `${date}T10:00:00Z` };
}

function attend(prickleId: string, memberId: string) {
  return { prickle_id: prickleId, member_id: memberId };
}

describe('computeScheduledPrickleStats', () => {
  it('returns empty array when no prickles exist', () => {
    expect(computeScheduledPrickleStats([t1], [], [])).toEqual([]);
  });

  it('excludes types with zero sessions', () => {
    const result = computeScheduledPrickleStats([t1, t2], [prickle('p1', 't1', '2026-01-01')], []);
    expect(result).toHaveLength(1);
    expect(result[0].typeId).toBe('t1');
  });

  it('counts sessions per type correctly', () => {
    const prickles = [
      prickle('p1', 't1', '2026-01-01'),
      prickle('p2', 't1', '2026-01-08'),
      prickle('p3', 't2', '2026-01-01'),
    ];
    const result = computeScheduledPrickleStats([t1, t2], prickles, []);
    const h = result.find((r) => r.typeId === 't1')!;
    const o = result.find((r) => r.typeId === 't2')!;
    expect(h.sessions).toBe(2);
    expect(o.sessions).toBe(1);
  });

  it('counts distinct members per prickle (multi-row attendance)', () => {
    const prickles = [prickle('p1', 't1', '2026-01-01')];
    const attendance = [
      attend('p1', 'm1'),
      attend('p1', 'm1'), // duplicate — same member rejoined
      attend('p1', 'm2'),
    ];
    const result = computeScheduledPrickleStats([t1], prickles, attendance);
    expect(result[0].min).toBe(2);
    expect(result[0].max).toBe(2);
  });

  it('computes min, mean, max, mode correctly', () => {
    const prickles = [
      prickle('p1', 't1', '2026-01-01'),
      prickle('p2', 't1', '2026-01-08'),
      prickle('p3', 't1', '2026-01-15'),
      prickle('p4', 't1', '2026-01-22'),
    ];
    // attendance counts: p1=2, p2=4, p3=4, p4=6
    const attendance = [
      attend('p1', 'm1'), attend('p1', 'm2'),
      attend('p2', 'm1'), attend('p2', 'm2'), attend('p2', 'm3'), attend('p2', 'm4'),
      attend('p3', 'm1'), attend('p3', 'm2'), attend('p3', 'm3'), attend('p3', 'm4'),
      attend('p4', 'm1'), attend('p4', 'm2'), attend('p4', 'm3'), attend('p4', 'm4'), attend('p4', 'm5'), attend('p4', 'm6'),
    ];
    const result = computeScheduledPrickleStats([t1], prickles, attendance);
    expect(result[0].min).toBe(2);
    expect(result[0].max).toBe(6);
    expect(result[0].mean).toBeCloseTo(4.0);
    expect(result[0].mode).toBe(4);
  });

  it('sparkline contains last 12 sessions when there are more than 12', () => {
    const prickles = Array.from({ length: 15 }, (_, i) =>
      prickle(`p${i}`, 't1', `2026-01-${String(i + 1).padStart(2, '0')}`)
    );
    const result = computeScheduledPrickleStats([t1], prickles, []);
    expect(result[0].sparkline).toHaveLength(12);
  });

  it('sparkline contains all sessions when there are 12 or fewer', () => {
    const prickles = Array.from({ length: 5 }, (_, i) =>
      prickle(`p${i}`, 't1', `2026-01-${String(i + 1).padStart(2, '0')}`)
    );
    const result = computeScheduledPrickleStats([t1], prickles, []);
    expect(result[0].sparkline).toHaveLength(5);
  });

  it('sparkline values are ordered oldest to newest', () => {
    const prickles = [
      prickle('p1', 't1', '2026-01-01'),
      prickle('p2', 't1', '2026-01-08'),
      prickle('p3', 't1', '2026-01-15'),
    ];
    const attendance = [
      attend('p1', 'm1'),
      attend('p2', 'm1'), attend('p2', 'm2'),
      attend('p3', 'm1'), attend('p3', 'm2'), attend('p3', 'm3'),
    ];
    const result = computeScheduledPrickleStats([t1], prickles, attendance);
    expect(result[0].sparkline).toEqual([1, 2, 3]);
  });

  it('sorts results by session count descending', () => {
    const prickles = [
      prickle('p1', 't1', '2026-01-01'),
      prickle('p2', 't2', '2026-01-01'),
      prickle('p3', 't2', '2026-01-08'),
      prickle('p4', 't2', '2026-01-15'),
    ];
    const result = computeScheduledPrickleStats([t1, t2], prickles, []);
    expect(result[0].typeId).toBe('t2'); // 3 sessions
    expect(result[1].typeId).toBe('t1'); // 1 session
  });

  it('lastSession is the most recent prickle date regardless of input order', () => {
    const prickles = [
      prickle('p1', 't1', '2026-03-10'),
      prickle('p2', 't1', '2026-01-01'),
      prickle('p3', 't1', '2026-02-15'),
    ];
    const result = computeScheduledPrickleStats([t1], prickles, []);
    expect(result[0].lastSession).toBe('2026-03-10T10:00:00Z');
  });

  it('prickles with null type_id are ignored', () => {
    const prickles = [{ id: 'p1', type_id: null, start_time: '2026-01-01T10:00:00Z' }];
    const result = computeScheduledPrickleStats([t1], prickles, []);
    expect(result).toHaveLength(0);
  });
});
