import { describe, it, expect } from 'vitest';
import { filterTrivialPups } from '@/lib/processing/attendance';

function makePup(clientId: string, durationMinutes: number) {
  const start = new Date('2026-05-28T04:39:00Z');
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  return {
    client_prickle_id: clientId,
    type_id: 'pup-type-uuid',
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    source: 'zoom',
    zoom_meeting_uuid: 'meeting-uuid',
  };
}

function makeAttendance(clientId: string | null, memberId: string) {
  return {
    client_prickle_id: clientId,
    prickle_id: clientId === null ? 'some-real-uuid' : null,
    member_id: memberId,
    join_time: new Date('2026-05-28T04:39:00Z').toISOString(),
    leave_time: new Date('2026-05-28T04:40:00Z').toISOString(),
    confidence_score: 'high',
  };
}

describe('filterTrivialPups', () => {
  it('filters a PUP with 1 attendee and <5 min duration', () => {
    const pups = [makePup('pup_0', 1)];
    const attendance = [makeAttendance('pup_0', 'member-1')];
    const result = filterTrivialPups(pups, attendance);
    expect(result.filteredPups).toHaveLength(0);
    expect(result.filteredAttendance).toHaveLength(0);
    expect(result.removedCount).toBe(1);
  });

  it('does not filter a PUP with 1 attendee but >=5 min duration', () => {
    const pups = [makePup('pup_0', 5)];
    const attendance = [makeAttendance('pup_0', 'member-1')];
    const result = filterTrivialPups(pups, attendance);
    expect(result.filteredPups).toHaveLength(1);
    expect(result.filteredAttendance).toHaveLength(1);
    expect(result.removedCount).toBe(0);
  });

  it('does not filter a PUP with 2+ attendees even if <5 min', () => {
    const pups = [makePup('pup_0', 1)];
    const attendance = [
      makeAttendance('pup_0', 'member-1'),
      makeAttendance('pup_0', 'member-2'),
    ];
    const result = filterTrivialPups(pups, attendance);
    expect(result.filteredPups).toHaveLength(1);
    expect(result.filteredAttendance).toHaveLength(2);
    expect(result.removedCount).toBe(0);
  });

  it('filters a PUP with 0 attendees and <5 min duration', () => {
    const pups = [makePup('pup_0', 1)];
    const result = filterTrivialPups(pups, []);
    expect(result.filteredPups).toHaveLength(0);
    expect(result.removedCount).toBe(1);
  });

  it('does not filter a PUP with 0 attendees but >=5 min duration', () => {
    const pups = [makePup('pup_0', 10)];
    const result = filterTrivialPups(pups, []);
    expect(result.filteredPups).toHaveLength(1);
    expect(result.removedCount).toBe(0);
  });

  it('only filters trivial PUPs among multiple', () => {
    const pups = [makePup('pup_0', 1), makePup('pup_1', 1), makePup('pup_2', 30)];
    const attendance = [
      makeAttendance('pup_0', 'member-1'),           // trivial: 1 min, 1 person
      makeAttendance('pup_1', 'member-1'),            // trivial: 1 min, 1 person
      makeAttendance('pup_1', 'member-2'),            // pup_1 has 2 people → keep
      makeAttendance('pup_2', 'member-1'),
    ];
    const result = filterTrivialPups(pups, attendance);
    expect(result.filteredPups.map(p => p.client_prickle_id)).toEqual(['pup_1', 'pup_2']);
    expect(result.filteredAttendance.filter(a => a.client_prickle_id === 'pup_0')).toHaveLength(0);
    expect(result.filteredAttendance.filter(a => a.client_prickle_id === 'pup_1')).toHaveLength(2);
    expect(result.removedCount).toBe(1);
  });

  it('preserves calendar attendance records (null client_prickle_id) untouched', () => {
    const pups = [makePup('pup_0', 1)];
    const attendance = [
      makeAttendance(null, 'member-1'),   // calendar record, not a PUP
      makeAttendance('pup_0', 'member-1'),
    ];
    const result = filterTrivialPups(pups, attendance);
    expect(result.filteredAttendance).toHaveLength(1);
    expect(result.filteredAttendance[0].prickle_id).toBe('some-real-uuid');
    expect(result.removedCount).toBe(1);
  });

  it('counts unique members per PUP (not attendance record count)', () => {
    // Same member rejoined → still only 1 unique person → trivial
    const pups = [makePup('pup_0', 2)];
    const attendance = [
      makeAttendance('pup_0', 'member-1'),
      makeAttendance('pup_0', 'member-1'), // same member, second session
    ];
    const result = filterTrivialPups(pups, attendance);
    expect(result.filteredPups).toHaveLength(0);
    expect(result.removedCount).toBe(1);
  });

  it('uses strict <5 min threshold (exactly 5 min is kept)', () => {
    const pups = [makePup('pup_0', 5)];
    const attendance = [makeAttendance('pup_0', 'member-1')];
    const result = filterTrivialPups(pups, attendance);
    expect(result.filteredPups).toHaveLength(1);
    expect(result.removedCount).toBe(0);
  });

  it('returns empty results for empty inputs', () => {
    const result = filterTrivialPups([], []);
    expect(result.filteredPups).toHaveLength(0);
    expect(result.filteredAttendance).toHaveLength(0);
    expect(result.removedCount).toBe(0);
  });
});
