import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Fixed-window rate limiting backed by public.rate_limit_hit() (see its migration). Every call
 * counts as a hit. Server-only: needs the service-role client.
 */

export interface RateLimit {
  /** Bucket name, e.g. `slack_code:ip:203.0.113.7`. */
  bucket: string;
  windowSeconds: number;
  maxHits: number;
}

/**
 * Record a hit on each limit and return whether all of them still allow the request. Fails open
 * (allows, and logs) if the database call itself fails: callers use this to slow abuse of
 * credentials that are already infeasible to guess, not as their only protection.
 */
export async function hitRateLimits(service: SupabaseClient, limits: RateLimit[]): Promise<boolean> {
  const results = await Promise.all(
    limits.map(async ({ bucket, windowSeconds, maxHits }) => {
      const { data, error } = await service.rpc("rate_limit_hit", {
        p_bucket: bucket,
        p_window_seconds: windowSeconds,
        p_max_hits: maxHits,
      });
      if (error) {
        console.error("rate-limit: rate_limit_hit failed for %s:", bucket, error);
        return true;
      }
      return data === true;
    })
  );
  return results.every(Boolean);
}

/** The requesting client's IP from forwarded headers (set by Vercel's edge), or "unknown". */
export function clientIpFrom(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}
