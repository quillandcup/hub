import { unstable_cache } from "next/cache";
import { clock } from "@/lib/clock";
import { getServiceRepos } from "@/lib/data/server";
import { installedPageDataLoaders } from "@/modules/server";
import { liveCacheOptions } from "./live-cache";
import { resolveLiveBlocks, type PageDataLoader } from "./live-data";
import { createStatsLoader } from "./live-stats-loader";
import { loadLiveStats } from "./live-stats";

/**
 * The server side of live landing data: the loaders with the service role, behind a cache (`live-cache.ts`). What is cached holds
 * counts, sums and public titles and times only; the real "now" is applied after the cache, so "In 12 min" stays right
 * for the minute the figures are allowed to be old.
 *
 * The page's loaders are the core one (the Outcome numbers' figures) and the ones the installed modules contribute
 * (`src/modules/server.ts`), all through the same `PageDataLoader` contract.
 */

export { LIVE_CACHE_SECONDS, LIVE_CACHE_TAG } from "./live-cache";

const cachedStats = unstable_cache(async (keys: string[]) => loadLiveStats(getServiceRepos(), keys, new Date(clock.now())), ["landing-live-stats"], liveCacheOptions);

export const serverLoaders: readonly PageDataLoader[] = [createStatsLoader(cachedStats), ...installedPageDataLoaders];

/** A landing page's document with the live values of its live blocks in it, for one render. Never save the result. */
export function withLiveData(data: unknown): Promise<unknown> {
  return resolveLiveBlocks(data, serverLoaders, new Date(clock.now()));
}
