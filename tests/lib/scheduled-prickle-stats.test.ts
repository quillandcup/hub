import { describe, it, expect } from 'vitest';
import {
  computeScheduledPrickleStats,
  computeGroupedPrickleStats,
  type PrickleWithHost,
} from '@/lib/scheduled-prickle-stats';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const t1 = { id: 't1', name: 'Heads Down', normalized_name: 'heads-down' };
const t2 = { id: 't2', name: 'Open Table', normalized_name: 'open-table' };

function prickle(id: string, typeId: string, date: string) {
  return { id, type_id: typeId, start_time: `${date}T10:00:00Z` };
}

function attend(prickleId: string, memberId: string) {
  return { prickle_id: prickleId, member_id: memberId };
}

// All dates below are in January (EST = UTC-5). Offsets shown in comments.
// Mondays: 2026-01-05, 2026-01-12, 2026-01-19, 2026-01-26
// Tuesdays: 2026-01-06, 2026-01-13

/** Prickle at a specific UTC ISO timestamp, with optional host. */
function pw(
  id: string,
  isoTime: string,
  host?: { id: string; name: string } | null
): PrickleWithHost {
  return { id, type_id: 't1', start_time: isoTime, host: host ?? null };
}

// ---------------------------------------------------------------------------
// computeScheduledPrickleStats
// ---------------------------------------------------------------------------

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

  it('computes min, median, mean, max correctly', () => {
    const prickles = [
      prickle('p1', 't1', '2026-01-01'),
      prickle('p2', 't1', '2026-01-08'),
      prickle('p3', 't1', '2026-01-15'),
      prickle('p4', 't1', '2026-01-22'),
    ];
    // attendance counts: p1=2, p2=4, p3=4, p4=6 → sorted [2,4,4,6] → median=4
    const attendance = [
      attend('p1', 'm1'), attend('p1', 'm2'),
      attend('p2', 'm1'), attend('p2', 'm2'), attend('p2', 'm3'), attend('p2', 'm4'),
      attend('p3', 'm1'), attend('p3', 'm2'), attend('p3', 'm3'), attend('p3', 'm4'),
      attend('p4', 'm1'), attend('p4', 'm2'), attend('p4', 'm3'), attend('p4', 'm4'), attend('p4', 'm5'), attend('p4', 'm6'),
    ];
    const result = computeScheduledPrickleStats([t1], prickles, attendance);
    expect(result[0].min).toBe(2);
    expect(result[0].max).toBe(6);
    expect(result[0].median).toBe(4);
    expect(result[0].mean).toBeCloseTo(4.0);
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

  it('includes normalizedName from prickle type', () => {
    const result = computeScheduledPrickleStats(
      [t1],
      [prickle('p1', 't1', '2026-01-05')],
      []
    );
    expect(result[0].normalizedName).toBe('heads-down');
  });

  it('normalizedName falls back to empty string when not provided', () => {
    const typeNoNorm = { id: 't3', name: 'Unnamed' };
    const result = computeScheduledPrickleStats(
      [typeNoNorm],
      [prickle('p1', 't3', '2026-01-05')],
      []
    );
    expect(result[0].normalizedName).toBe('');
  });
});

// ---------------------------------------------------------------------------
// computeGroupedPrickleStats — by schedule
// ---------------------------------------------------------------------------

describe('computeGroupedPrickleStats — by schedule', () => {
  // In January (EST = UTC-5):
  // Mon 2026-01-05 at 11:00 AM ET = 2026-01-05T16:00:00Z
  // Mon 2026-01-12 at 11:00 AM ET = 2026-01-12T16:00:00Z   ← same slot
  // Mon 2026-01-05 at  2:00 PM ET = 2026-01-05T19:00:00Z   ← different time slot
  // Tue 2026-01-06 at 11:00 AM ET = 2026-01-06T16:00:00Z   ← different day slot

  const MON_11AM_1  = '2026-01-05T16:00:00Z';
  const MON_11AM_2  = '2026-01-12T16:00:00Z';
  const MON_2PM     = '2026-01-05T19:00:00Z';
  const TUE_11AM    = '2026-01-06T16:00:00Z';

  it('returns empty array when no prickles', () => {
    expect(computeGroupedPrickleStats([], [], 'schedule')).toEqual([]);
  });

  it('groups prickles that share the same ET day and time', () => {
    const prickles = [pw('p1', MON_11AM_1), pw('p2', MON_11AM_2)];
    const groups = computeGroupedPrickleStats(prickles, [], 'schedule');
    expect(groups).toHaveLength(1);
    expect(groups[0].sessions).toBe(2);
  });

  it('creates separate groups for different time slots on the same day', () => {
    const prickles = [pw('p1', MON_11AM_1), pw('p2', MON_2PM)];
    const groups = computeGroupedPrickleStats(prickles, [], 'schedule');
    expect(groups).toHaveLength(2);
  });

  it('creates separate groups for the same time on different days', () => {
    const prickles = [pw('p1', MON_11AM_1), pw('p2', TUE_11AM)];
    const groups = computeGroupedPrickleStats(prickles, [], 'schedule');
    expect(groups).toHaveLength(2);
  });

  it('sorts groups by day of week then by time', () => {
    const prickles = [
      pw('p1', TUE_11AM),    // Tuesday
      pw('p2', MON_2PM),     // Monday 2pm
      pw('p3', MON_11AM_1),  // Monday 11am
    ];
    const groups = computeGroupedPrickleStats(prickles, [], 'schedule');
    expect(groups).toHaveLength(3);
    // Monday 11am, Monday 2pm, Tuesday 11am
    expect(groups[0].groupLabel).toContain('Monday');
    expect(groups[0].groupLabel).toContain('11:00 AM');
    expect(groups[1].groupLabel).toContain('Monday');
    expect(groups[1].groupLabel).toContain('2:00 PM');
    expect(groups[2].groupLabel).toContain('Tuesday');
  });

  it('group label is "{Weekday}s at {Time} ET"', () => {
    const prickles = [pw('p1', MON_11AM_1)];
    const groups = computeGroupedPrickleStats(prickles, [], 'schedule');
    expect(groups[0].groupLabel).toBe('Mondays at 11:00 AM ET');
  });

  it('computes correct stats within a group', () => {
    const prickles = [pw('p1', MON_11AM_1), pw('p2', MON_11AM_2)];
    const attendance = [
      attend('p1', 'm1'), attend('p1', 'm2'),          // p1 → 2 attendees
      attend('p2', 'm1'), attend('p2', 'm2'), attend('p2', 'm3'), // p2 → 3 attendees
    ];
    const groups = computeGroupedPrickleStats(prickles, attendance, 'schedule');
    expect(groups[0].sessions).toBe(2);
    expect(groups[0].min).toBe(2);
    expect(groups[0].max).toBe(3);
    expect(groups[0].mean).toBeCloseTo(2.5);
    expect(groups[0].median).toBeCloseTo(2.5);
    expect(groups[0].sparkline).toEqual([2, 3]);
  });

  it('lastSession reflects the most recent session in the group', () => {
    const prickles = [pw('p1', MON_11AM_1), pw('p2', MON_11AM_2)];
    const groups = computeGroupedPrickleStats(prickles, [], 'schedule');
    expect(groups[0].lastSession).toBe(MON_11AM_2);
  });
});

// ---------------------------------------------------------------------------
// computeGroupedPrickleStats — by host
// ---------------------------------------------------------------------------

describe('computeGroupedPrickleStats — by host', () => {
  const AJ   = { id: 'h1', name: 'AJ' };
  const JENN = { id: 'h2', name: 'Jenn P' };

  it('returns empty array when no prickles', () => {
    expect(computeGroupedPrickleStats([], [], 'host')).toEqual([]);
  });

  it('groups prickles by host', () => {
    const prickles = [
      pw('p1', '2026-01-05T16:00:00Z', AJ),
      pw('p2', '2026-01-06T16:00:00Z', AJ),
      pw('p3', '2026-01-07T16:00:00Z', JENN),
    ];
    const groups = computeGroupedPrickleStats(prickles, [], 'host');
    expect(groups).toHaveLength(2);
    const aj = groups.find((g) => g.groupLabel === 'AJ')!;
    const jenn = groups.find((g) => g.groupLabel === 'Jenn P')!;
    expect(aj.sessions).toBe(2);
    expect(jenn.sessions).toBe(1);
  });

  it('sorts groups alphabetically by host name', () => {
    const prickles = [
      pw('p1', '2026-01-07T16:00:00Z', JENN),
      pw('p2', '2026-01-05T16:00:00Z', AJ),
    ];
    const groups = computeGroupedPrickleStats(prickles, [], 'host');
    expect(groups[0].groupLabel).toBe('AJ');
    expect(groups[1].groupLabel).toBe('Jenn P');
  });

  it('places null-host prickles in "No Host Assigned" group sorted last', () => {
    const prickles = [
      pw('p1', '2026-01-05T16:00:00Z', AJ),
      pw('p2', '2026-01-06T16:00:00Z', null),
    ];
    const groups = computeGroupedPrickleStats(prickles, [], 'host');
    expect(groups).toHaveLength(2);
    expect(groups[groups.length - 1].groupLabel).toBe('No Host Assigned');
  });

  it('groups all null-host prickles together', () => {
    const prickles = [
      pw('p1', '2026-01-05T16:00:00Z', null),
      pw('p2', '2026-01-06T16:00:00Z', null),
    ];
    const groups = computeGroupedPrickleStats(prickles, [], 'host');
    expect(groups).toHaveLength(1);
    expect(groups[0].sessions).toBe(2);
    expect(groups[0].groupLabel).toBe('No Host Assigned');
  });

  it('handles host as array (Supabase join may return array)', () => {
    const prickleWithArrayHost: PrickleWithHost = {
      id: 'p1',
      type_id: 't1',
      start_time: '2026-01-05T16:00:00Z',
      host: [AJ] as any,
    };
    const groups = computeGroupedPrickleStats([prickleWithArrayHost], [], 'host');
    expect(groups[0].groupLabel).toBe('AJ');
  });

  it('computes correct stats within a host group', () => {
    const prickles = [
      pw('p1', '2026-01-05T16:00:00Z', AJ),
      pw('p2', '2026-01-12T16:00:00Z', AJ),
    ];
    const attendance = [
      attend('p1', 'm1'), attend('p1', 'm2'), attend('p1', 'm3'), // p1 → 3
      attend('p2', 'm1'),                                          // p2 → 1
    ];
    const groups = computeGroupedPrickleStats(prickles, attendance, 'host');
    const aj = groups.find((g) => g.groupLabel === 'AJ')!;
    expect(aj.sessions).toBe(2);
    expect(aj.min).toBe(1);
    expect(aj.max).toBe(3);
    expect(aj.mean).toBeCloseTo(2.0);
    expect(aj.sparkline).toEqual([3, 1]);
  });

  it('distinct member count per session (not total attendance rows)', () => {
    const prickles = [pw('p1', '2026-01-05T16:00:00Z', AJ)];
    const attendance = [
      attend('p1', 'm1'),
      attend('p1', 'm1'), // rejoined — same member
      attend('p1', 'm2'),
    ];
    const groups = computeGroupedPrickleStats(prickles, attendance, 'host');
    expect(groups[0].min).toBe(2);
    expect(groups[0].max).toBe(2);
  });
});
