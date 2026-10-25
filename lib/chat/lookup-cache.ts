import { unstable_cache } from "next/cache";

/**
 * Short cross-request cache for chat lookups that are keyed by Slack ids or emoji names and are the
 * same for every member (Slack names, photos, channel names, custom emoji). Never put per-member data
 * (the channel list, whose RLS depends on the caller) or message text through this.
 *
 * Stale for at most LOOKUP_TTL_SECONDS; the Slack import and the chat projection call
 * invalidateChatLookups() when they write the source tables. A lookup that throws is not cached
 * (unstable_cache only stores a returned value), and the caller gets an empty result instead.
 */
export const LOOKUP_TTL_SECONDS = 300;
export const CHAT_LOOKUPS_TAG = "chat-slack-lookups";

export function cachedLookup<V>(name: string, fn: (keys: string[]) => Promise<Record<string, V>>) {
  const cached = unstable_cache((keys: string[]) => fn(keys), ["chat-lookup", name], {
    revalidate: LOOKUP_TTL_SECONDS,
    tags: [CHAT_LOOKUPS_TAG],
  });
  return async (input: string[]): Promise<Record<string, V>> => {
    const keys = [...new Set(input)].sort();
    if (keys.length === 0) return {};
    try {
      return await cached(keys);
    } catch (error) {
      // Outside a Next request (scripts, some tests) there is no cache: run the lookup directly.
      const outsideNext = error instanceof Error && /incrementalCache/i.test(error.message);
      if (!outsideNext) console.error(`[chat] ${name} lookup failed`, error);
      try {
        return outsideNext ? await fn(keys) : {};
      } catch (inner) {
        console.error(`[chat] ${name} lookup failed`, inner);
        return {};
      }
    }
  };
}
