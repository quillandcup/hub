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

  it('hides attendee count label in member mode', () => {
    expect(src).toContain('mode !== "member"');
    expect(src).toMatch(/mode !== "member"[\s\S]{0,100}text-xs font-bold/);
  });
});
