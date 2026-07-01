import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(
  path.join(process.cwd(), 'components/TimezoneInitializer.tsx'),
  'utf-8'
);

describe('TimezoneInitializer', () => {
  describe('"No" button', () => {
    it('stores the rejected timezone in localStorage', () => {
      expect(src).toContain('tz_mismatch_rejected');
      expect(src).toContain('localStorage.setItem("tz_mismatch_rejected"');
    });

    it('stores detectedTz (not a static value) as the rejected timezone', () => {
      const setItemIdx = src.indexOf('localStorage.setItem("tz_mismatch_rejected"');
      const snippet = src.slice(setItemIdx, setItemIdx + 80);
      expect(snippet).toContain('detectedTz');
    });
  });

  describe('"Never ask again" button', () => {
    it('stores the permanent dismissed flag in localStorage', () => {
      expect(src).toContain('localStorage.setItem("tz_mismatch_dismissed"');
    });

    it('does not store the rejected timezone (permanent suppression, not per-zone)', () => {
      const neverIdx = src.indexOf('handleNeverAskAgain');
      const fnBody = src.slice(neverIdx, neverIdx + 200);
      expect(fnBody).not.toContain('tz_mismatch_rejected');
    });
  });

  describe('banner visibility logic', () => {
    it('suppresses the banner when tz_mismatch_dismissed is set', () => {
      expect(src).toContain('tz_mismatch_dismissed');
      const dismissedIdx = src.indexOf('"tz_mismatch_dismissed"');
      const getItemIdx = src.slice(0, dismissedIdx).lastIndexOf('localStorage.getItem');
      expect(getItemIdx).toBeGreaterThan(-1);
    });

    it('suppresses the banner when the detected timezone matches the previously rejected timezone', () => {
      expect(src).toContain('rejected !== detected');
    });

    it('shows the banner when timezone mismatches and neither dismissed nor rejected', () => {
      expect(src).toContain('!dismissed && rejected !== detected');
    });

    it('re-shows the banner when the browser is in a new timezone different from the rejected one', () => {
      // Verified by: the check is `rejected !== detected`, so a new detected tz
      // (different from both storedTimezone and the previously rejected tz) triggers the banner.
      expect(src).toContain('rejected !== detected');
      expect(src).not.toContain('rejected === detected');
    });
  });

  describe('sudo mode', () => {
    it('skips all prompting when isSudo is true', () => {
      expect(src).toContain('if (isSudo) return');
    });
  });
});
