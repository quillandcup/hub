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
  it('reads the prickle in the selected timezone and the column as the calendar date it is', () => {
    // The prickle's instant is read in the selected timezone, so a prickle near midnight UTC (8pm ET =
    // 2026-06-19T00:00Z) lands on the right calendar day. The column is a calendar date built from
    // year/month/day components, so it is read as those components, never formatted in a timezone: that shifts it a
    // day whenever the host's zone differs from the viewer's (server vs browser; see CalendarWeekViewLayout.test.tsx).
    const block = src.match(/function isSameCalendarDay[\s\S]*?itemDateStr === dayDateStr/)?.[0] ?? '';
    expect((block.match(/timeZone: timezone/g) ?? []).length).toBe(1);
    expect(block).toMatch(/dayDateStr = `[^`]*day\.getMonth\(\)[^`]*day\.getDate\(\)[^`]*day\.getFullYear\(\)/);
  });

  it('does not format the column date in a timezone (regression guard)', () => {
    expect(src).not.toMatch(/dayDateStr = day\.toLocaleDateString/);
  });

  it('hides attendee count label in member mode', () => {
    expect(src).toContain('mode !== "member"');
    expect(src).toMatch(/mode !== "member"[\s\S]{0,200}text-xs font-bold/);
  });
});

describe('CalendarWeekView slot-picking mode', () => {
  it('accepts onSlotClick, proposedSlots, and selectedSlot props', () => {
    expect(src).toContain('onSlotClick?:');
    expect(src).toContain('proposedSlots?:');
    expect(src).toContain('selectedSlot?:');
  });

  it('disables click-to-navigate on prickle blocks when onSlotClick is provided', () => {
    // onSlotClick wins over both onPrickleClick (commit picking) and click-to-navigate.
    expect(src).toMatch(
      /onClick=\{\s*onSlotClick\s*\?\s*undefined\s*:\s*selectable\s*\?\s*\(\) => onPrickleClick\(prickle\)\s*:\s*\(\) => router\.push\(`\$\{prickleBasePath\}\/\$\{prickle\.id\}`\)\s*\}/
    );
    expect(src).toContain('const selectable = onPrickleClick && !onSlotClick;');
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
