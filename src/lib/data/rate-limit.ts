import type { Db } from "./db";
import type { InMemoryDataset } from "./in-memory";

/**
 * Fixed-window hit counters (`rate_limit_counters`, through `rate_limit_hit()`). Service role only.
 * Throws on a database error; callers decide whether to fail open or closed.
 */
export interface RateLimitRepository {
  /** Records one hit on the bucket and says whether it is still within `maxHits` for the current window of `windowSeconds`. */
  hit(bucket: string, windowSeconds: number, maxHits: number): Promise<boolean>;
}

export class SupabaseRateLimitRepository implements RateLimitRepository {
  constructor(private readonly db: Db) {}

  async hit(bucket: string, windowSeconds: number, maxHits: number) {
    const { data, error } = await this.db.rpc("rate_limit_hit", { p_bucket: bucket, p_window_seconds: windowSeconds, p_max_hits: maxHits });
    if (error) throw new Error(error.message);
    return data === true;
  }
}

/** The counters of each in-memory dataset: bucket to its current window and hits. */
const counters = new WeakMap<InMemoryDataset, Map<string, { window: number; hits: number }>>();

/** In-memory twin over an `InMemoryDataset`. */
export class InMemoryRateLimitRepository implements RateLimitRepository {
  constructor(private readonly data: InMemoryDataset) {}

  async hit(bucket: string, windowSeconds: number, maxHits: number) {
    let mine = counters.get(this.data);
    if (!mine) counters.set(this.data, (mine = new Map()));
    const window = Math.floor(Date.now() / 1000 / windowSeconds);
    const current = mine.get(bucket);
    const hits = current && current.window === window ? current.hits + 1 : 1;
    mine.set(bucket, { window, hits });
    return hits <= maxHits;
  }
}
