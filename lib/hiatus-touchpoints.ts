// Hiatus outreach touchpoint tracking — replicates the "Hiatus 25% / 50% /
// 75%" columns from the spreadsheet this replaces. member_status_overrides
// already has everything needed: starts_at is the hiatus start, and
// expires_at (the existing "Expires At (optional)" field on the override
// form) is the planned/expected end. An indefinite hiatus (expires_at null)
// has no known duration, so no percentage/touchpoint is computable for it.

export interface HiatusTouchpoint {
  percentElapsed: number | null;
  nextTouchpoint: { pct: 25 | 50 | 75; date: string } | null;
  isPastAllTouchpoints: boolean;
}

const TOUCHPOINT_PERCENTS: Array<25 | 50 | 75> = [25, 50, 75];

export function computeHiatusTouchpoint(
  startsAt: string,
  expiresAt: string | null,
  asOf: Date
): HiatusTouchpoint {
  if (!expiresAt) {
    return { percentElapsed: null, nextTouchpoint: null, isPastAllTouchpoints: false };
  }

  const startMs = new Date(startsAt).getTime();
  const endMs = new Date(expiresAt).getTime();
  const totalMs = endMs - startMs;
  if (totalMs <= 0) {
    return { percentElapsed: null, nextTouchpoint: null, isPastAllTouchpoints: false };
  }

  const asOfMs = asOf.getTime();
  const percentElapsed = Math.max(0, Math.min(100, ((asOfMs - startMs) / totalMs) * 100));

  let nextTouchpoint: HiatusTouchpoint["nextTouchpoint"] = null;
  for (const pct of TOUCHPOINT_PERCENTS) {
    const markMs = startMs + totalMs * (pct / 100);
    if (markMs > asOfMs) {
      nextTouchpoint = { pct, date: new Date(markMs).toISOString() };
      break;
    }
  }

  return {
    percentElapsed,
    nextTouchpoint,
    isPastAllTouchpoints: percentElapsed >= 75,
  };
}
