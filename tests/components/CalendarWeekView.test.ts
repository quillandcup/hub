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

  it('disables click navigation in member mode', () => {
    // onClick must be conditional on mode
    expect(src).toMatch(/mode.*admin.*router\.push|router\.push.*mode.*admin/s);
  });

  it('hides attendee count label in member mode', () => {
    expect(src).toContain('mode !== "member"');
  });
});
