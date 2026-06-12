import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(
  path.join(process.cwd(), 'app/(admin)/admin/calendar/page.tsx'),
  'utf-8'
);

describe('AdminCalendarPage navigation', () => {
  it('prev week link points to /admin/calendar not /calendar', () => {
    // Extract all href strings that reference calendar navigation
    const calendarLinks = src.match(/href=\{`[^`]*calendar[^`]*`\}/g) || [];
    expect(calendarLinks.length).toBeGreaterThan(0);
    calendarLinks.forEach((link) => {
      expect(link).toContain('/admin/calendar');
      expect(link).not.toMatch(/href=\{`\/calendar\?/);
    });
  });

  it('next week link points to /admin/calendar not /calendar', () => {
    // Both prev and next links must use /admin/calendar
    const memberCalendarLinks = src.match(/href=\{`\/calendar\?week=/g) || [];
    expect(memberCalendarLinks).toHaveLength(0);
  });

  it('uses /admin/calendar for prev week param', () => {
    expect(src).toContain('/admin/calendar?week=${prevWeekParam}');
  });

  it('uses /admin/calendar for next week param', () => {
    expect(src).toContain('/admin/calendar?week=${nextWeekParam}');
  });
});
