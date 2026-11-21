import { unstable_cache } from "next/cache";
import { clock } from "@/lib/clock";
import { getServiceRepos } from "@/lib/data/server";
import { liveCacheOptions } from "@/lib/landing/live-cache";
import type { PageDataLoader } from "@/lib/landing/live-data";
import { loadComingUp, type ComingUpOptions } from "./live-events";
import { createEventsLoader } from "./live-loader";
import { loadScheduleSnapshot } from "./live-schedule";

/**
 * The events integration's server half: its live data loader with the service role, behind the same one-minute cache as every
 * live figure (`src/lib/landing/live-cache.ts`). Server only: it reads the database. The blocks themselves are in `blocks.tsx`.
 */

const cachedSchedule = unstable_cache(async () => loadScheduleSnapshot(getServiceRepos(), new Date(clock.now())), ["landing-live-schedule"], liveCacheOptions);

const cachedComingUp = unstable_cache(async (options: ComingUpOptions) => loadComingUp(getServiceRepos(), options, new Date(clock.now())), ["landing-live-coming-up"], liveCacheOptions);

export const eventsPageDataLoaders: readonly PageDataLoader[] = [createEventsLoader({ schedule: cachedSchedule, comingUp: cachedComingUp })];
