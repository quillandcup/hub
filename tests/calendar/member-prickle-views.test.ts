import { describe, it, expect } from 'vitest';
import { buildMemberPrickleViews } from '@/lib/calendar/member-prickle-views';

const makePrickle = (id: string, overrides = {}) => ({
  id,
  start_time: '2026-05-12T14:00:00Z',
  end_time: '2026-05-12T15:00:00Z',
  prickle_types: [{ name: 'Morning Writing' }],
  ...overrides,
});

describe('buildMemberPrickleViews', () => {
  it('only includes prickles the member attended', () => {
    const prickles = [makePrickle('a'), makePrickle('b'), makePrickle('c')];
    const attendedIds = new Set(['a', 'c']);
    const countByPrickle = new Map([['a', 3], ['c', 7]]);

    const result = buildMemberPrickleViews(prickles, attendedIds, countByPrickle);

    expect(result.map(p => p.id)).toEqual(['a', 'c']);
  });

  it('sets attendance_count from countByPrickle', () => {
    const prickles = [makePrickle('a')];
    const attendedIds = new Set(['a']);
    const countByPrickle = new Map([['a', 12]]);

    const result = buildMemberPrickleViews(prickles, attendedIds, countByPrickle);

    expect(result[0].attendance_count).toBe(12);
  });

  it('falls back to 1 if prickle not in countByPrickle', () => {
    const prickles = [makePrickle('a')];
    const attendedIds = new Set(['a']);
    const countByPrickle = new Map<string, number>();

    const result = buildMemberPrickleViews(prickles, attendedIds, countByPrickle);

    expect(result[0].attendance_count).toBe(1);
  });

  it('uses prickle_types.name as prickle_type', () => {
    const prickles = [makePrickle('a', { prickle_types: [{ name: 'Deep Work' }] })];
    const attendedIds = new Set(['a']);
    const countByPrickle = new Map([['a', 2]]);

    const result = buildMemberPrickleViews(prickles, attendedIds, countByPrickle);

    expect(result[0].prickle_type).toBe('Deep Work');
  });

  it('falls back to "Unknown" when prickle_types is null', () => {
    const prickles = [makePrickle('a', { prickle_types: null })];
    const attendedIds = new Set(['a']);
    const countByPrickle = new Map([['a', 1]]);

    const result = buildMemberPrickleViews(prickles, attendedIds, countByPrickle);

    expect(result[0].prickle_type).toBe('Unknown');
  });

  it('sets host fields to empty/false for member view', () => {
    const prickles = [makePrickle('a')];
    const attendedIds = new Set(['a']);
    const countByPrickle = new Map([['a', 2]]);

    const result = buildMemberPrickleViews(prickles, attendedIds, countByPrickle);

    expect(result[0].host).toBe('');
    expect(result[0].host_id).toBeUndefined();
    expect(result[0].host_missing).toBe(false);
    expect(result[0].host_late).toBe(false);
  });
});
