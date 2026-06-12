import { describe, it, expect } from 'vitest';

/**
 * Tests for the attendance_count deduplication logic in the admin calendar page.
 *
 * CRITICAL: The attendance table stores multiple records per (member_id, prickle_id)
 * when a member leaves and rejoins. The calendar card must show unique attendees,
 * not raw record count.
 *
 * Fix: Use new Set(records.map(a => a.member_id)).size instead of records.length
 */

function computeAttendanceCount(
  records: { member_id: string }[] | null | undefined
): number {
  return new Set((records ?? []).map((a) => a.member_id)).size;
}

describe('Calendar attendance count deduplication', () => {
  it('counts zero for no attendance records', () => {
    expect(computeAttendanceCount([])).toBe(0);
    expect(computeAttendanceCount(null)).toBe(0);
    expect(computeAttendanceCount(undefined)).toBe(0);
  });

  it('counts one for a single member with one record', () => {
    expect(computeAttendanceCount([{ member_id: 'alice' }])).toBe(1);
  });

  it('counts one for a member who left and rejoined (multiple records, same member)', () => {
    const records = [
      { member_id: 'alice' },
      { member_id: 'alice' },
    ];
    expect(computeAttendanceCount(records)).toBe(1);
  });

  it('counts distinct members correctly when some have multiple records', () => {
    // Scenario matching the 6-records / 5-attendees bug:
    // Natalie left and rejoined → 2 records; 4 others have 1 each = 6 total, 5 unique
    const records = [
      { member_id: 'natalie' },
      { member_id: 'vivian' },
      { member_id: 'iris' },
      { member_id: 'edy' },
      { member_id: 'lilian' },
      { member_id: 'natalie' }, // rejoined
    ];
    expect(computeAttendanceCount(records)).toBe(5);
  });

  it('counts distinct members when many have multiple records', () => {
    // Scenario matching the 15-records / 7-attendees bug
    const records = [
      { member_id: 'lili' },
      { member_id: 'aj' },
      { member_id: 'lm' },
      { member_id: 'lili' },
      { member_id: 'aj' },
      { member_id: 'lm' },
      { member_id: 'ellen' },
      { member_id: 'ellen' },
      { member_id: 'natalie' },
      { member_id: 'natalie' },
      { member_id: 'candace' },
      { member_id: 'candace' },
      { member_id: 'lili' },
      { member_id: 'katy' },
      { member_id: 'katy' },
    ];
    expect(computeAttendanceCount(records)).toBe(7);
  });

  it('counts all members when no one has multiple records', () => {
    const records = [
      { member_id: 'alice' },
      { member_id: 'bob' },
      { member_id: 'carol' },
    ];
    expect(computeAttendanceCount(records)).toBe(3);
  });
});
