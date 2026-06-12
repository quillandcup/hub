import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(
  path.join(process.cwd(), 'components/AttendanceListTable.tsx'),
  'utf-8'
);

describe('AttendanceListTable', () => {
  describe('props interface', () => {
    it('accepts attendance, timezone, activeListDateKey, memberId, memberBasePath', () => {
      expect(src).toContain('attendance');
      expect(src).toContain('timezone');
      expect(src).toContain('activeListDateKey');
      expect(src).toContain('memberId');
      expect(src).toContain('memberBasePath');
    });

    it('does not manage its own navigation state', () => {
      expect(src).not.toContain('setCurrentListDateKey');
      expect(src).not.toContain('handlePrev');
      expect(src).not.toContain('handleNext');
    });
  });

  describe('grouping and ordering', () => {
    it('groups records by date descending (most recent first)', () => {
      expect(src).toContain('descendingDateKeys');
      // descending sort: parseDateKey(b) - parseDateKey(a)
      expect(src).toContain('parseDateKey(b) - parseDateKey(a)');
    });

    it('renders a date header row before each group', () => {
      expect(src).toContain('header-${dateKey}');
      expect(src).toContain('formatDateKey(dateKey)');
    });

    it('assigns a scrollable id to each date header', () => {
      expect(src).toContain('list-date-${dateKey.replace');
    });
  });

  describe('active date highlighting', () => {
    it('highlights the active date header in blue', () => {
      expect(src).toContain('isActive');
      expect(src).toContain('dateKey === activeListDateKey');
      expect(src).toContain('border-blue-500');
    });
  });

  describe('scrolling', () => {
    it('scrolls to the active date section when activeListDateKey changes', () => {
      expect(src).toContain('scrollIntoView');
      expect(src).toContain('[activeListDateKey]');
    });
  });

  describe('table structure', () => {
    it('has columns for Prickle Type, Time, Duration, Host', () => {
      expect(src).toContain('Prickle Type');
      expect(src).toContain('Time');
      expect(src).toContain('Duration');
      expect(src).toContain('Host');
    });

    it('navigates to prickle on row click', () => {
      expect(src).toContain('router.push(`/prickles/${prickle.id}`)');
    });

    it('marks hosted prickles with a star', () => {
      expect(src).toContain('prickle.host?.id === memberId');
      expect(src).toContain('⭐');
    });

    it('shows an empty state when attendance is empty', () => {
      expect(src).toContain('attendance.length === 0');
      expect(src).toContain('No attendance records');
    });
  });

  describe('date key helpers', () => {
    it('has parseDateKey for chronological sorting', () => {
      expect(src).toContain('function parseDateKey');
    });

    it('has formatDateKey to render "Mon DD, YYYY" labels', () => {
      expect(src).toContain('function formatDateKey');
      expect(src).toContain('month: "short"');
      expect(src).toContain('year: "numeric"');
    });
  });
});
