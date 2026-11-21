import { resolveLiveBlocks as resolveWith } from "@/lib/landing/live-data";
import { createStatsLoader, neededStats, type LoadStats } from "@/lib/landing/live-stats-loader";
import { createEventsLoader, neededEventData, type EventsLoaders } from "@/modules/events/page-blocks/live-loader";

/**
 * The live data loaders of the installed composition (the pages code's figures and the events integration's schedule and coming up),
 * given as the three reads the tests fake. `resolveLiveBlocks` runs a page through the same plumbing the server uses
 * (`src/lib/landing/live-server.ts`), minus the cache.
 */
export type LiveLoaders = EventsLoaders & { stats: LoadStats };

export const loadersFor = (l: LiveLoaders) => [createStatsLoader(l.stats), createEventsLoader(l)];

export const resolveLiveBlocks = (data: unknown, l: LiveLoaders, now?: Date) => resolveWith(data, loadersFor(l), now);

/** What a page asks of every loader. */
export const needsLiveData = (page: unknown) => ({ stats: neededStats(page), ...neededEventData(page) });
