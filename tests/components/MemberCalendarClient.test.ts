import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(
  path.join(process.cwd(), 'components/MemberCalendarClient.tsx'),
  'utf-8'
);

const pageSrc = fs.readFileSync(
  path.join(process.cwd(), 'app/(member)/calendar/page.tsx'),
  'utf-8'
);

// Inline helpers from MemberCalendarClient for unit testing
function formatWeekRange(start: Date, endExclusive: Date): string {
  const end = new Date(endExclusive);
  end.setDate(end.getDate() - 1);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const s = start.toLocaleDateString('en-US', opts);
  const e = end.toLocaleDateString('en-US', { ...opts, year: 'numeric' });
  return `${s} – ${e}`;
}

function parseDateKey(k: string): number {
  const [m, d, y] = k.split('/').map(Number);
  return new Date(y, m - 1, d).getTime();
}

function sortedDateKeys(keys: string[]): string[] {
  return [...keys].sort((a, b) => parseDateKey(a) - parseDateKey(b));
}

describe('MemberCalendarClient', () => {
  describe('unified header structure', () => {
    it('has all three views in a single toggle group', () => {
      expect(src).toContain('["month", "week", "list"]');
    });

    it('does not contain an "Attendance History" heading', () => {
      expect(src).not.toContain('Attendance History');
    });

    it('has exactly one h1 heading', () => {
      const h1Matches = src.match(/<h1/g) || [];
      expect(h1Matches).toHaveLength(1);
    });

    it('shows the same Prev/label/Today/Next nav for all views', () => {
      // No conditional hiding of nav per view — nav block is always rendered
      expect(src).not.toContain('view !== "list"');
      // The unified nav block contains handlePrev, navLabel, handleToday, handleNext
      expect(src).toContain('handlePrev');
      expect(src).toContain('navLabel');
      expect(src).toContain('handleToday');
      expect(src).toContain('handleNext');
    });
  });

  describe('timezone selector', () => {
    it('renders at top level before the view toggle', () => {
      const timezoneIdx = src.indexOf('Timezone:');
      const viewToggleIdx = src.indexOf('["month", "week", "list"]');
      expect(timezoneIdx).toBeGreaterThan(-1);
      expect(viewToggleIdx).toBeGreaterThan(-1);
      expect(timezoneIdx).toBeLessThan(viewToggleIdx);
    });

    it('supports browser timezone detection', () => {
      expect(src).toContain('defaultTimezone === "browser"');
      expect(src).toContain('Intl.DateTimeFormat().resolvedOptions().timeZone');
    });

    it('passes selected timezone to CalendarWeekView', () => {
      expect(src).toContain('userTimezonePreference={timezone}');
    });

    it('passes selected timezone to CalendarScrollContainer', () => {
      expect(src).toContain('timezone={timezone}');
    });

    it('resets list date when timezone changes', () => {
      // When timezone changes the dateKeys change format, so currentListDateKey must reset
      expect(src).toContain('setCurrentListDateKey(null)');
    });
  });

  describe('navigation — month and week', () => {
    it('handlePrev navigates month backward', () => {
      const prevFn = src.slice(src.indexOf('const handlePrev'), src.indexOf('const handleNext'));
      expect(prevFn).toContain('view === "month"');
      expect(prevFn).toContain('getMonth() - 1');
    });

    it('handleNext navigates month forward', () => {
      const nextFn = src.slice(src.indexOf('const handleNext'), src.indexOf('const handleToday'));
      expect(nextFn).toContain('view === "month"');
      expect(nextFn).toContain('getMonth() + 1');
    });

    it('handlePrev navigates week backward by 7 days', () => {
      const prevFn = src.slice(src.indexOf('const handlePrev'), src.indexOf('const handleNext'));
      expect(prevFn).toContain('view === "week"');
      expect(prevFn).toContain('getDate() - 7');
    });

    it('handleNext navigates week forward by 7 days', () => {
      const nextFn = src.slice(src.indexOf('const handleNext'), src.indexOf('const handleToday'));
      expect(nextFn).toContain('view === "week"');
      expect(nextFn).toContain('getDate() + 7');
    });

    it('disables Next for future weeks', () => {
      expect(src).toContain('isNextWeekDisabled');
      expect(src).toContain('cursor-not-allowed');
    });
  });

  describe('navigation — list view', () => {
    it('handlePrev navigates to the previous day with an entry', () => {
      const prevFn = src.slice(src.indexOf('const handlePrev'), src.indexOf('const handleNext'));
      expect(prevFn).toContain('view === "list"');
      expect(prevFn).toContain('sortedDateKeys[currentListDateIdx - 1]');
    });

    it('handleNext navigates to the next day with an entry', () => {
      const nextFn = src.slice(src.indexOf('const handleNext'), src.indexOf('const handleToday'));
      expect(nextFn).toContain('view === "list"');
      expect(nextFn).toContain('sortedDateKeys[currentListDateIdx + 1]');
    });

    it('disables Prev at the oldest date', () => {
      expect(src).toContain('isPrevDisabled');
      expect(src).toContain('currentListDateIdx <= 0');
    });

    it('disables Next at the most recent date', () => {
      expect(src).toContain('isNextDisabled');
      expect(src).toContain('currentListDateIdx >= sortedDateKeys.length - 1');
    });

    it('handleToday in list view jumps to today or most recent past entry', () => {
      const todayFn = src.slice(src.indexOf('const handleToday'), src.indexOf('const navLabel'));
      expect(todayFn).toContain('view === "list"');
      expect(todayFn).toContain('sortedDateKeys.includes(todayKey)');
    });

    it('navLabel shows the active date in list view', () => {
      expect(src).toContain('effectiveListDateKey');
      expect(src).toContain('formatDateKey(effectiveListDateKey)');
    });

    it('defaults to the most recent date with entries', () => {
      // effectiveListDateKey falls back to the last item in sortedDateKeys
      expect(src).toContain('sortedDateKeys.at(-1)');
    });

    it('scrolls to the active date section when it changes', () => {
      expect(src).toContain('scrollIntoView');
      expect(src).toContain('list-date-');
    });

    it('list is grouped by date with section headers', () => {
      expect(src).toContain('descendingDateKeys');
      expect(src).toContain('header-${dateKey}');
    });

    it('highlights the active date section', () => {
      expect(src).toContain('isActive');
      expect(src).toContain('dateKey === effectiveListDateKey');
    });
  });

  describe('week range formatting', () => {
    it('has a formatWeekRange helper', () => {
      expect(src).toContain('function formatWeekRange');
    });

    it('uses en-dash as separator', () => {
      expect(src).toContain('–');
    });

    it('renders range for the first week of June 2026', () => {
      const start = new Date(2026, 5, 1); // Jun 1
      const endExclusive = new Date(2026, 5, 8);
      expect(formatWeekRange(start, endExclusive)).toBe('Jun 1 – Jun 7, 2026');
    });

    it('handles month-boundary weeks', () => {
      const start = new Date(2026, 4, 31); // May 31
      const endExclusive = new Date(2026, 5, 7);
      expect(formatWeekRange(start, endExclusive)).toBe('May 31 – Jun 6, 2026');
    });

    it('handles year-boundary weeks', () => {
      const start = new Date(2025, 11, 28); // Dec 28
      const endExclusive = new Date(2026, 0, 4);
      expect(formatWeekRange(start, endExclusive)).toBe('Dec 28 – Jan 3, 2026');
    });
  });

  describe('list date key sorting', () => {
    it('sorts MM/DD/YYYY keys chronologically', () => {
      const keys = ['06/12/2026', '01/05/2026', '12/31/2025', '06/01/2026'];
      const sorted = sortedDateKeys(keys);
      expect(sorted).toEqual(['12/31/2025', '01/05/2026', '06/01/2026', '06/12/2026']);
    });

    it('handles same-month ordering', () => {
      const keys = ['06/30/2026', '06/01/2026', '06/15/2026'];
      const sorted = sortedDateKeys(keys);
      expect(sorted).toEqual(['06/01/2026', '06/15/2026', '06/30/2026']);
    });
  });

  describe('week view data', () => {
    it('deduplicates prickles for the selected week', () => {
      expect(src).toContain('seenPrickleIds');
      expect(src).toContain('seenPrickleIds.has(prickle.id)');
    });

    it('renders CalendarWeekView in member mode', () => {
      expect(src).toContain('mode="member"');
    });

    it('derives all data from attendance prop (no extra fetch)', () => {
      expect(src).not.toContain('supabase');
      expect(src).not.toContain('createClient');
    });
  });

  describe('calendar page integration', () => {
    it('page imports and renders MemberCalendarClient', () => {
      expect(pageSrc).toContain('MemberCalendarClient');
    });

    it('page no longer has its own view toggle markup', () => {
      expect(pageSrc).not.toContain('bg-slate-100 dark:bg-slate-800 rounded-lg p-1');
    });

    it('page no longer has its own Prev/Next navigation', () => {
      expect(pageSrc).not.toContain('← Previous');
      expect(pageSrc).not.toContain('Next →');
    });

    it('page passes initialView from URL param', () => {
      expect(pageSrc).toContain('initialView={initialView}');
    });

    it('page supports list as a valid view param', () => {
      expect(pageSrc).toContain('"list"');
    });
  });
});
