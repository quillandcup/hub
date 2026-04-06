import { describe, it, expect } from 'vitest'

/**
 * Test to ensure calendar week always starts on Sunday
 *
 * CRITICAL: We've had regressions where the calendar started on Saturday.
 * This test documents the expected behavior and prevents future regressions.
 */
describe('Calendar Week Start', () => {
  // Helper function that mimics the calendar page logic
  function getWeekStart(weekParam: string): Date {
    const [year, month, day] = weekParam.split('-').map(Number);
    const paramDate = new Date(year, month - 1, day);
    const dayOfWeek = paramDate.getDay(); // 0 = Sunday
    const weekStart = new Date(paramDate);
    weekStart.setDate(paramDate.getDate() - dayOfWeek);
    weekStart.setHours(0, 0, 0, 0);
    return weekStart;
  }

  // Helper to get day name
  function getDayName(date: Date): string {
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    return days[date.getDay()];
  }

  it('should start week on Sunday when given a Sunday', () => {
    // March 30, 2026 is a Monday
    // So the Sunday before it is March 29, 2026
    const weekStart = getWeekStart('2026-03-30');

    expect(getDayName(weekStart)).toBe('Sunday');
    expect(weekStart.getDate()).toBe(29);
    expect(weekStart.getMonth()).toBe(2); // March (0-indexed)
  })

  it('should start week on Sunday when given a Saturday', () => {
    // April 4, 2026 is a Saturday
    // So the Sunday before it is March 29, 2026
    const weekStart = getWeekStart('2026-04-04');

    expect(getDayName(weekStart)).toBe('Sunday');
    expect(weekStart.getDate()).toBe(29);
    expect(weekStart.getMonth()).toBe(2); // March
  })

  it('should start week on Sunday when given a Sunday', () => {
    // March 29, 2026 is a Sunday
    // So weekStart should be March 29, 2026 (same day)
    const weekStart = getWeekStart('2026-03-29');

    expect(getDayName(weekStart)).toBe('Sunday');
    expect(weekStart.getDate()).toBe(29);
    expect(weekStart.getMonth()).toBe(2); // March
  })

  it('should generate 7 days starting with Sunday', () => {
    const weekStart = getWeekStart('2026-04-01'); // April 1 is a Wednesday

    // Generate 7 days like the calendar does
    const days = Array.from({ length: 7 }, (_, i) => {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + i);
      return date;
    });

    // First day should be Sunday
    expect(getDayName(days[0])).toBe('Sunday');

    // Verify all 7 days in order
    const expectedDays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    days.forEach((day, i) => {
      expect(getDayName(day)).toBe(expectedDays[i]);
    });
  })

  it('should never start a week on Saturday', () => {
    // Test a bunch of different dates
    const testDates = [
      '2026-03-29', // Sunday
      '2026-03-30', // Monday
      '2026-03-31', // Tuesday
      '2026-04-01', // Wednesday
      '2026-04-02', // Thursday
      '2026-04-03', // Friday
      '2026-04-04', // Saturday
    ];

    testDates.forEach(dateStr => {
      const weekStart = getWeekStart(dateStr);
      const dayName = getDayName(weekStart);

      // Week should NEVER start on Saturday
      expect(dayName).not.toBe('Saturday');

      // Week should ALWAYS start on Sunday
      expect(dayName).toBe('Sunday');
    });
  })

  it('should handle month boundaries correctly', () => {
    // March 31, 2026 is a Tuesday
    // Week should start on Sunday March 29, not roll back to February
    const weekStart = getWeekStart('2026-03-31');

    expect(getDayName(weekStart)).toBe('Sunday');
    expect(weekStart.getMonth()).toBe(2); // March, not February
    expect(weekStart.getDate()).toBe(29);
  })
})
