import type { Repos } from "@/lib/data/repos";
import { membersWithFeature } from "@/lib/features.server";
import type { FeatureKey } from "@/lib/features";

/** The flag behind writers' public pages (docs/WRITER_PROFILES.md, "The feature flag"). */
export const WRITER_PAGES_FEATURE: FeatureKey = "writer_pages";

/** Why a change is refused while the flag is not on for the member (the page's settings stay as they are). */
export const WRITER_PAGES_NOT_AVAILABLE = "Pages on the web are not open to you yet.";

type FlagRepos = Pick<Repos, "featureFlags" | "members" | "segments">;

/**
 * Which of these page owners have the `writer_pages` flag on, in a few batched queries however many there are (the global
 * switch, segments and each member's own preview, as every flag; `membersWithFeature`). The flag is decided for the page's
 * owner: a visitor has none. Pass service-role repositories, since it reads other members' previews.
 */
export function ownersWithWriterPages(repos: FlagRepos, memberIds: string[]): Promise<Set<string>> {
  return membersWithFeature(repos, WRITER_PAGES_FEATURE, memberIds);
}

/** Whether this one member has the flag on. */
export async function memberHasWriterPages(repos: FlagRepos, memberId: string): Promise<boolean> {
  return (await ownersWithWriterPages(repos, [memberId])).has(memberId);
}
