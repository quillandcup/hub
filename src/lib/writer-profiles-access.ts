import type { Repos } from "@/lib/data/repos";
import { membersWithFeature } from "@/lib/features.server";
import type { FeatureKey } from "@/lib/features";

/** The flag behind writer profiles (docs/product/WRITER_PROFILES.md, "The feature flag"). */
export const WRITER_PROFILES_FEATURE: FeatureKey = "writer_profiles";

/** Why a change is refused while the flag is not on for the member (the page's settings stay as they are). */
export const WRITER_PROFILES_NOT_AVAILABLE = "Writer profiles are not open to you yet.";

/** Why the profile cannot be switched on yet: no name was chosen for it. The name on the account is never used unless the member picks it. */
export const WRITER_PROFILE_NAME_NEEDED = "Choose the name your profile shows first, under \"Name shown\".";

type FlagRepos = Pick<Repos, "featureFlags" | "members" | "segments">;

/**
 * Which of these page owners have the `writer_profiles` flag on, in a few batched queries however many there are (the global
 * switch, segments and each member's own preview, as every flag; `membersWithFeature`). The flag is decided for the page's
 * owner: a visitor has none. Pass service-role repositories, since it reads other members' previews.
 */
export function ownersWithWriterProfiles(repos: FlagRepos, memberIds: string[]): Promise<Set<string>> {
  return membersWithFeature(repos, WRITER_PROFILES_FEATURE, memberIds);
}

/** Whether this one member has the flag on. */
export async function memberHasWriterProfiles(repos: FlagRepos, memberId: string): Promise<boolean> {
  return (await ownersWithWriterProfiles(repos, [memberId])).has(memberId);
}
