import { unstable_cache } from "next/cache";
import { clock } from "@/lib/clock";
import { getServiceRepos } from "@/lib/data/server";
import { loadComingUp, type ComingUpOptions } from "./live-events";
import { resolveLiveBlocks, type LiveLoaders } from "./live-data";
import { loadScheduleSnapshot } from "./live-schedule";
import { loadLiveStats } from "./live-stats";

/**
 * The server side of live landing data: the loaders with the service role, behind a cache. The public page is open to
 * anyone, so traffic must not multiply database load: each aggregate is computed at most once a minute per set of
 * figures, whoever asks and however often (`unstable_cache`, revalidate `LIVE_CACHE_SECONDS`). What is cached holds
 * counts, sums and public titles and times only; the real "now" is applied after the cache, so "In 12 min" stays right
 * for the minute the figures are allowed to be old.
 */

export const LIVE_CACHE_SECONDS = 60;
export const LIVE_CACHE_TAG = "landing-live";
const cacheOptions = { revalidate: LIVE_CACHE_SECONDS, tags: [LIVE_CACHE_TAG] };

const cachedStats = unstable_cache(async (keys: string[]) => loadLiveStats(getServiceRepos(), keys, new Date(clock.now())), ["landing-live-stats"], cacheOptions);
const cachedSchedule = unstable_cache(async () => loadScheduleSnapshot(getServiceRepos(), new Date(clock.now())), ["landing-live-schedule"], cacheOptions);

const cachedComingUp = unstable_cache(async (options: ComingUpOptions) => loadComingUp(getServiceRepos(), options, new Date(clock.now())), ["landing-live-coming-up"], cacheOptions);

export const serverLoaders: LiveLoaders = { stats: cachedStats, schedule: cachedSchedule, comingUp: cachedComingUp };

/** A landing page's document with the live values of its live blocks in it, for one render. Never save the result. */
export function withLiveData(data: unknown): Promise<unknown> {
  return resolveLiveBlocks(data, serverLoaders, new Date(clock.now()));
}
