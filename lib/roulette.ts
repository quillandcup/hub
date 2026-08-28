// Pure scoring/selection logic for Hedgie Roulette. Kept side-effect free (no
// Supabase/Slack calls) so the weighting and gating behavior can be unit
// tested with injected randomness and a fake presence check — the real
// Slack API call lives in app/(member)/roulette/actions.ts.

export interface RouletteCandidate {
  memberId: string;
  memberName: string;
  photoUrl: string | null;
  /** Slack user ID from member_name_aliases (source='slack'), or null if unmatched. */
  slackUserId: string | null;
  /** Distinct other members this candidate has ever shared a prickle with. */
  connectionCount: number;
  /** Slack messages/reactions in the trailing engagement window. */
  recentSlackActivityCount: number;
}

// A flat floor weight so even well-connected, highly active members keep a
// nonzero chance of being drawn — this is still meant to feel like a wheel
// spin, not a deterministic "always pick the loneliest hedgie" queue.
const BASE_WEIGHT = 0.15;

/**
 * Higher for members with fewer connections and less recent Slack activity —
 * these are the re-engagement candidates the roulette should favor.
 */
export function scoreCandidate(candidate: RouletteCandidate): number {
  const connectionDeficit = 1 / (1 + candidate.connectionCount);
  const engagementDeficit = 1 / (1 + candidate.recentSlackActivityCount);
  return connectionDeficit + engagementDeficit + BASE_WEIGHT;
}

/**
 * Weighted draw without replacement — returns every candidate ordered by a
 * series of weighted random picks, so callers can walk the list trying each
 * in turn (e.g. until one passes a live reachability check).
 */
export function weightedDrawOrder(
  candidates: RouletteCandidate[],
  rng: () => number = Math.random
): RouletteCandidate[] {
  const pool = candidates.map((c) => ({ c, w: scoreCandidate(c) }));
  const order: RouletteCandidate[] = [];

  while (pool.length > 0) {
    const total = pool.reduce((sum, p) => sum + p.w, 0);
    let r = rng() * total;
    let idx = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      r -= pool[i].w;
      if (r <= 0) {
        idx = i;
        break;
      }
    }
    order.push(pool[idx].c);
    pool.splice(idx, 1);
  }

  return order;
}

export interface PickRouletteMatchOptions {
  /** How many weighted draws to try before giving up. Default 6. */
  maxAttempts?: number;
  rng?: () => number;
}

/**
 * Draws candidates in weighted order and returns the first one that passes
 * `isReachable` (in practice: a live Slack presence check). Candidates
 * without a mapped Slack user are never eligible — we can't reach them and
 * can't reliably check presence for them.
 *
 * Returns null if nobody currently reachable turns up within maxAttempts —
 * callers should treat that as "no one's around right now," not an error.
 */
export async function pickRouletteMatch(
  candidates: RouletteCandidate[],
  isReachable: (candidate: RouletteCandidate) => Promise<boolean>,
  options: PickRouletteMatchOptions = {}
): Promise<RouletteCandidate | null> {
  const eligible = candidates.filter((c): c is RouletteCandidate & { slackUserId: string } => c.slackUserId !== null);
  const order = weightedDrawOrder(eligible, options.rng ?? Math.random);
  const maxAttempts = options.maxAttempts ?? 6;

  for (const candidate of order.slice(0, maxAttempts)) {
    if (await isReachable(candidate)) return candidate;
  }
  return null;
}

/**
 * Builds the decorative photo reel shown on the wheel: the winner plus a
 * shuffled sample of other candidates to fill out the remaining slots.
 * Purely presentational — has no bearing on who was actually picked.
 */
export function buildReel(
  winner: RouletteCandidate,
  pool: RouletteCandidate[],
  slotCount: number,
  rng: () => number = Math.random
): RouletteCandidate[] {
  const others = pool.filter((c) => c.memberId !== winner.memberId);
  const shuffled = [...others];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return [winner, ...shuffled.slice(0, Math.max(0, slotCount - 1))];
}
