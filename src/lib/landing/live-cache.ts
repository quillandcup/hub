/**
 * How long the live figures of a landing page may be old. The public page is open to anyone, so traffic must not multiply
 * database load: each aggregate is computed at most once a minute per set of figures (`unstable_cache`, revalidate
 * `LIVE_CACHE_SECONDS`), whoever asks and however often. Shared by the core loader (`live-server.ts`) and the loaders that
 * modules contribute, so one tag clears them all.
 */
export const LIVE_CACHE_SECONDS = 60;
export const LIVE_CACHE_TAG = "landing-live";
export const liveCacheOptions = { revalidate: LIVE_CACHE_SECONDS, tags: [LIVE_CACHE_TAG] };
