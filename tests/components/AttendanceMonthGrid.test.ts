import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(
  path.join(process.cwd(), 'components/AttendanceMonthGrid.tsx'),
  'utf-8'
);

describe('AttendanceMonthGrid', () => {
  describe('props interface', () => {
    it('accepts attendance, timezone, currentMonthDate, memberId, memberBasePath', () => {
      expect(src).toContain('attendance');
      expect(src).toContain('timezone');
      expect(src).toContain('currentMonthDate');
      expect(src).toContain('memberId');
      expect(src).toContain('memberBasePath');
    });

    it('does not manage its own timezone state', () => {
      expect(src).not.toContain('setTimezone');
      expect(src).not.toContain('useState(timezone)');
    });

    it('does not accept nav props (currentMonthDate is driven by parent)', () => {
      expect(src).not.toContain('handlePrev');
      expect(src).not.toContain('handleNext');
      expect(src).not.toContain('setCurrentMonthDate');
    });
  });

  describe('calendar grid', () => {
    it('renders a 7-column grid', () => {
      expect(src).toContain('grid-cols-7');
    });

    it('renders day-of-week headers starting with Sunday', () => {
      expect(src).toContain('"Sun"');
      const sunIdx = src.indexOf('"Sun"');
      const monIdx = src.indexOf('"Mon"');
      expect(sunIdx).toBeLessThan(monIdx);
    });

    it('highlights today with a blue border', () => {
      expect(src).toContain('isToday');
      expect(src).toContain('border-blue-500');
    });

    it('shows prickle type pills on days with attendance', () => {
      expect(src).toContain('prickle_types?.name');
      expect(src).toContain('bg-blue-100');
    });

    it('shows overflow count when more than 3 events on a day', () => {
      expect(src).toContain('att.length > 3');
      expect(src).toContain('more');
    });
  });

  describe('selected day panel', () => {
    it('tracks selectedDay in local state', () => {
      expect(src).toContain('selectedDay');
      expect(src).toContain('setSelectedDay');
    });

    it('shows prickle details when a day with attendance is selected', () => {
      expect(src).toContain('selectedAtt.length > 0');
    });

    it('shows an empty state when a day with no attendance is selected', () => {
      expect(src).toContain('selectedAtt.length === 0');
      expect(src).toContain('No attendance recorded');
    });

    it('navigates to prickle on click', () => {
      expect(src).toContain('router.push(`/prickles/${prickle.id}`)');
    });

    it('marks hosted prickles with a star', () => {
      expect(src).toContain('prickle.host?.id === memberId');
      expect(src).toContain('⭐');
    });
  });

  describe('timezone usage', () => {
    it('groups attendance by date in the given timezone', () => {
      expect(src).toContain('timeZone: timezone');
    });

    it('formats display times in the given timezone', () => {
      expect(src).toContain('formatTime');
      expect(src).toContain('timeZone: timezone');
    });
  });
});
