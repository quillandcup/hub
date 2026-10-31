import type { FoundProfile, ProspectSource } from "./types";

// Bluesky's public AppView answers these without an account or app review.
const API = "https://public.api.bsky.app/xrpc";
const PAGE = 25;
const PAGES_PER_QUERY = 2;
// getProfiles takes at most 25 actors.
const PROFILES_PER_CALL = 25;

type SearchedActor = { did: string; handle: string; description?: string };
type DetailedProfile = { handle: string; description?: string; followersCount?: number };

/**
 * What people write in a Bluesky bio when they are writing a book. Bluesky's search matches words in
 * the profile, so these are phrases, not hashtags. The rules in `rules.ts` decide who is a fit;
 * these only decide who gets looked at.
 */
export const BLUESKY_QUERIES = [
  "working on my first novel",
  "writing my first book",
  "novelist drafting",
  "aspiring author",
  "memoir writer",
  "writing a memoir",
  "fantasy author wip",
  "romance writer drafting",
  "poet working on a collection",
  "amwriting",
] as const;

async function getJson<T>(fetchImpl: typeof fetch, path: string, params: Record<string, string | string[]>): Promise<T> {
  const url = new URL(`${API}/${path}`);
  for (const [key, value] of Object.entries(params)) for (const v of Array.isArray(value) ? value : [value]) url.searchParams.append(key, v);
  const response = await fetchImpl(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Bluesky ${path} answered ${response.status}`);
  return (await response.json()) as T;
}

const toProfile = (actor: { handle: string; description?: string }, followerCount: number | null): FoundProfile => {
  const bio = actor.description?.trim() || null;
  const link = bio?.match(/https?:\/\/[^\s)]+/i)?.[0] ?? null;
  return { platform: "bluesky", handle: actor.handle.toLowerCase(), bio, followerCount, externalUrl: link };
};

/** Bluesky actor search over `BLUESKY_QUERIES`, with follower counts from getProfiles. */
export const blueskySource: ProspectSource = {
  id: "bluesky-search",
  queries: BLUESKY_QUERIES,
  async discover(query, fetchImpl) {
    const actors: SearchedActor[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < PAGES_PER_QUERY; page++) {
      const result = await getJson<{ actors: SearchedActor[]; cursor?: string }>(fetchImpl, "app.bsky.actor.searchActors", { q: query, limit: String(PAGE), ...(cursor ? { cursor } : {}) });
      actors.push(...result.actors);
      cursor = result.cursor;
      if (!cursor || result.actors.length < PAGE) break;
    }

    const followers = new Map<string, number>();
    for (let i = 0; i < actors.length; i += PROFILES_PER_CALL) {
      const batch = actors.slice(i, i + PROFILES_PER_CALL);
      const { profiles } = await getJson<{ profiles: DetailedProfile[] }>(fetchImpl, "app.bsky.actor.getProfiles", { actors: batch.map((a) => a.did) });
      for (const profile of profiles) if (typeof profile.followersCount === "number") followers.set(profile.handle, profile.followersCount);
    }

    return actors.map((actor) => toProfile(actor, followers.get(actor.handle) ?? null));
  },
};

