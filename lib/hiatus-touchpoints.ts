// Hiatus outreach touchpoint tracking — replicates the "Hiatus 25% / 50% /
// 75%" columns from the spreadsheet this replaces. member_hiatus_history
// already has everything needed: start_date is the hiatus start, and
// end_date is the planned/expected end. An indefinite hiatus (end_date null)
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

export interface HiatusTouchpointMark {
  pct: 25 | 50 | 75;
  date: string; // ISO timestamp
}

// All three touchpoint dates for a known-duration hiatus window, regardless
// of whether they've been reached yet — unlike computeHiatusTouchpoint's
// "next only" view (for the at-a-glance /admin/hiatus display), this is the
// raw material for a work queue that tracks each mark independently
// (lib/admin-work-queue.ts), since 25/50/75% may need separate follow-ups.
export function computeAllHiatusTouchpoints(
  startsAt: string,
  expiresAt: string | null
): HiatusTouchpointMark[] {
  if (!expiresAt) return [];

  const startMs = new Date(startsAt).getTime();
  const endMs = new Date(expiresAt).getTime();
  const totalMs = endMs - startMs;
  if (totalMs <= 0) return [];

  return TOUCHPOINT_PERCENTS.map((pct) => ({
    pct,
    date: new Date(startMs + totalMs * (pct / 100)).toISOString(),
  }));
}
