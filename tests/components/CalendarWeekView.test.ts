import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(
  path.join(process.cwd(), 'components/CalendarWeekView.tsx'),
  'utf-8'
);

describe('CalendarWeekView mode prop', () => {
  it('accepts a mode prop in the interface', () => {
    expect(src).toContain('mode?:');
    expect(src).toContain('"admin"');
    expect(src).toContain('"member"');
  });

  it('hides legend in member mode', () => {
    expect(src).toContain('mode !== "member"');
  });

  it('uses prickleBasePath for click navigation instead of a hardcoded path', () => {
    expect(src).toContain('router.push(`${prickleBasePath}/${prickle.id}`)');
    expect(src).not.toContain('router.push(`/prickles/${prickle.id}`)');
    expect(src).not.toContain('router.push(`/admin/prickles/${prickle.id}`)');
  });

  it('accepts prickleBasePath prop defaulting to /prickles', () => {
    expect(src).toContain('prickleBasePath?:');
    expect(src).toContain('prickleBasePath = "/prickles"');
  });

  it('shows tooltip in member mode', () => {
    // Tooltip must not be gated on mode
    expect(src).not.toMatch(/hoveredPrickle === prickle\.id && mode !== "member"/);
  });
});

describe('CalendarWeekView day-to-prickle timezone matching', () => {
  it('uses selected timezone for both sides of the day-matching comparison', () => {
    // Both itemDateStr and dayDateStr must use the same timezone so prickles
    // near midnight UTC (e.g. 8pm ET = 2026-06-19T00:00Z) land on the correct
    // calendar day when the selected timezone differs from the browser's local one.
    // This comparison lives in the shared isSameCalendarDay helper, reused by
    // both prickle and proposed-slot day-grouping.
    const block = src.match(/function isSameCalendarDay[\s\S]*?itemDateStr === dayDateStr/)?.[0] ?? '';
    const count = (block.match(/timeZone: timezone/g) ?? []).length;
    expect(count).toBe(2);
  });

  it('dayDateStr includes timeZone option (regression guard)', () => {
    // Before the fix, dayDateStr called toLocaleDateString without timeZone,
    // causing it to use the browser's local timezone while prickleDateStr used
    // the calendar's selected timezone — mismatching for users near midnight UTC.
    expect(src).toMatch(/dayDateStr = day\.toLocaleDateString\([^)]*\{[^}]*timeZone: timezone/);
  });

  it('hides attendee count label in member mode', () => {
    expect(src).toContain('mode !== "member"');
    expect(src).toMatch(/mode !== "member"[\s\S]{0,100}text-xs font-bold/);
  });
});

describe('CalendarWeekView slot-picking mode', () => {
  it('accepts onSlotClick, proposedSlots, and selectedSlot props', () => {
    expect(src).toContain('onSlotClick?:');
    expect(src).toContain('proposedSlots?:');
    expect(src).toContain('selectedSlot?:');
  });

  it('disables click-to-navigate on prickle blocks when onSlotClick is provided', () => {
    expect(src).toContain('onClick={onSlotClick ? undefined : () => router.push(`${prickleBasePath}/${prickle.id}`)}');
  });

  it('wires an onClick on hour grid cells only when onSlotClick is provided', () => {
    expect(src).toMatch(/onClick=\{onSlotClick \? \(e\) => \{[\s\S]{0,300}onSlotClick\(\{ date: day, hour, minute \}\)/);
  });

  it('renders proposed slots as non-interactive context blocks', () => {
    const block = src.match(/proposedSlotsByDay\[dayIndex\]\.length > 0[\s\S]{0,900}/)?.[0] ?? '';
    expect(block).toContain('pointer-events-none');
    expect(block).not.toContain('onClick');
  });
});
