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
    // Both prickleDateStr and dayDateStr must use the same timezone so prickles
    // near midnight UTC (e.g. 8pm ET = 2026-06-19T00:00Z) land on the correct
    // calendar day when the selected timezone differs from the browser's local one.
    const block = src.match(/pricklesByDay[\s\S]*?prickleDateStr === dayDateStr/)?.[0] ?? '';
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
