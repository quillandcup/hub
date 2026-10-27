import type { SupabaseClient } from "@supabase/supabase-js";
import { clock } from "@/lib/clock";

/**
 * Refreshing a rotating Slack token without two requests doing it at once.
 *
 * Slack refresh tokens are single-use: the second of two simultaneous refreshes of one token is refused,
 * and a refused refresh would lose the credential (the member is asked to reconnect, or the bot stops
 * working until reinstalled). So a refresh is done under a lease (`slack_token_refresh_claim`, a row with
 * an expiry; supabase/migrations/20270202000000_slack_bot_token.sql explains why not a lock held across the
 * Slack call): whoever holds it refreshes and saves, everyone else either carries on with the credential
 * they already have if it hasn't expired yet (the usual case: a token is refreshed with time to spare) or
 * waits a moment for the holder's result.
 */

/** Longer than a refresh takes; a holder that dies leaves a lease that runs out after this. */
const LEASE_SECONDS = 60;
/** How long a request with nothing usable waits for the holder, in steps. */
const WAIT_STEPS = 25;
const WAIT_STEP_MS = 400;

export interface RefreshLeaseOptions<T> {
  /** What to use right now if the credential hasn't expired yet; null when it already has. */
  fallback: T | null;
  /** Read the stored credential again: the refreshed one once the holder has saved it, else null. */
  reread: () => Promise<T | null>;
  /** Do the refresh and save its result. Runs only for the request that holds the lease. */
  refresh: () => Promise<T>;
}

/**
 * Run `refresh` if this request wins the lease for `key` ('bot', or `member:<id>`); otherwise use `fallback`
 * or wait for the winner. Returns null when there is nothing to use after waiting.
 */
export async function withRefreshLease<T>(service: SupabaseClient, key: string, opts: RefreshLeaseOptions<T>): Promise<T | null> {
  const { data: claimed, error } = await service.rpc("slack_token_refresh_claim", { p_key: key, p_seconds: LEASE_SECONDS });
  if (error) throw error;

  if (claimed === true) {
    try {
      return await opts.refresh();
    } finally {
      // Saving releases it already; this covers a refresh that failed. Never let it hide the result.
      await service.rpc("slack_token_refresh_release", { p_key: key }).then(undefined, () => undefined);
    }
  }

  if (opts.fallback) return opts.fallback;
  for (let step = 0; step < WAIT_STEPS; step++) {
    await clock.sleep(WAIT_STEP_MS);
    const fresh = await opts.reread();
    if (fresh) return fresh;
  }
  return null;
}
