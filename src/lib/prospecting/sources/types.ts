import type { ProspectPlatform } from "@/lib/data/prospects";

/** A profile a source found, before it is scored. */
export type FoundProfile = {
  platform: ProspectPlatform;
  /** Lowercase, no "@". */
  handle: string;
  bio: string | null;
  followerCount: number | null;
  externalUrl: string | null;
};

/**
 * Somewhere to look for people. A source only finds profiles; scoring, the "already in the Hub"
 * check and storing are the same for all of them (`runSources`), so a new source never has to know
 * who we are looking for.
 */
export interface ProspectSource {
  /** Stored as the prospect's `source`, e.g. "bluesky-search". */
  id: string;
  /** What `discover` is asked to look for, in this source's own terms. */
  queries: readonly string[];
  /** Profiles matching one query; throws when the platform cannot be reached. */
  discover(query: string, fetchImpl: typeof fetch): Promise<FoundProfile[]>;
}
