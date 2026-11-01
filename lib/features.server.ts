import { createRepos, type Repos } from "@/lib/data/repos";
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service';
import type { FeatureKey } from '@/lib/features';

type FeatureRepos = Pick<Repos, "featureFlags" | "members" | "segments">;

/**
 * Resolve the effectively-enabled feature keys for a user in one shot.
 *
 * A flag is enabled if ANY of:
 *   1. feature_flags.enabled_globally is true for that key
 *   2. a user_feature_previews row exists for that user+key (per-user
 *      opt-in/override — the original mechanism, unchanged)
 *   3. the user's member is in a segment linked to that key via
 *      feature_flag_segments
 *
 * Callers (layouts) fetch this once per page load for the full set of keys,
 * so this issues a fixed, small number of queries regardless of how many
 * feature keys exist — never a per-flag round trip. Memoized per render via
 * React cache(), since admin layouts and several admin pages both ask for the
 * same user's flags on one request.
 */
export const getUserFeaturePreviews = cache(async (userId: string): Promise<FeatureKey[]> => {
  const repos = createRepos(await createClient());

  const [globalKeys, previewKeys, member] = await Promise.all([
    repos.featureFlags.globallyEnabledKeys(),
    repos.featureFlags.previewKeys(userId),
    repos.members.byUserId(userId),
  ]);

  const enabled = new Set<string>([...globalKeys, ...previewKeys]);

  if (member?.id) {
    const [segmentLinks, memberSegments] = await Promise.all([
      repos.featureFlags.segmentLinks(),
      repos.segments.segmentIdsForMember(member.id),
    ]);
    const memberSegmentIds = new Set(memberSegments);
    for (const link of segmentLinks) {
      if (memberSegmentIds.has(link.segmentId)) enabled.add(link.featureKey);
    }
  }

  return Array.from(enabled) as FeatureKey[];
});

/**
 * Which of these members have `key` on, by the same rules as getUserFeaturePreviews, in a few
 * batched queries (for senders working through many members). Only members with a Hub account
 * count: a flag is per signed-in user, and someone who can't sign in has nothing to see. Pass a
 * service-role client: it reads other users' previews.
 */
export async function membersWithFeature(repos: FeatureRepos, key: FeatureKey, memberIds: string[]): Promise<Set<string>> {
  const enabled = new Set<string>();
  const unique = [...new Set(memberIds)];
  if (unique.length === 0) return enabled;
  const [isGlobal, userIdByMember, segmentLinks] = await Promise.all([
    repos.featureFlags.isGloballyEnabled(key),
    repos.members.userIdsByMemberId(unique),
    repos.featureFlags.segmentLinks(key),
  ]);
  const withAccounts: { id: string; user_id: string }[] = [...userIdByMember]
    .filter((entry): entry is [string, string] => entry[1] !== null)
    .map(([id, user_id]) => ({ id, user_id }));
  if (isGlobal) return new Set(withAccounts.map((m) => m.id));

  const memberByUser = new Map(withAccounts.map((m) => [m.user_id, m.id]));
  const segmentIds = segmentLinks.map((link) => link.segmentId);
  const [previewUserIds, segmentMemberIds] = await Promise.all([
    repos.featureFlags.userIdsWithPreview(key, [...memberByUser.keys()]),
    repos.segments.memberIdsInSegments(segmentIds, withAccounts.map((m) => m.id)),
  ]);
  for (const userId of previewUserIds) {
    const memberId = memberByUser.get(userId);
    if (memberId) enabled.add(memberId);
  }
  for (const memberId of segmentMemberIds) enabled.add(memberId);
  return enabled;
}

/**
 * Like membersWithFeature, for a sender that reaches people outside the Hub (a Slack DM needs no
 * Hub account): when the flag is on globally it covers every member given, signed in or not.
 * Otherwise it's the same segments and per-user previews, which need an account.
 */
export async function membersWithFeatureForOutreach(
  repos: FeatureRepos,
  key: FeatureKey,
  memberIds: string[]
): Promise<Set<string>> {
  if (await repos.featureFlags.isGloballyEnabled(key)) return new Set(memberIds);
  return membersWithFeature(repos, key, memberIds);
}

/**
 * Whether the effective member has `key` on: the signed-in user's own flags normally, the sudo'd
 * member's (not the admin's) in sudo, so an admin sees exactly what that member would.
 * `ownFeatures` is the signed-in user's getUserFeaturePreviews result.
 */
export async function effectiveMemberHasFeature(
  key: FeatureKey,
  identity: { memberId: string; isSudo: boolean },
  ownFeatures: FeatureKey[]
): Promise<boolean> {
  if (!identity.isSudo) return ownFeatures.includes(key);
  return (await membersWithFeature(createRepos(createServiceRoleClient()), key, [identity.memberId])).has(identity.memberId);
}

/**
 * Whether `key` is switched on for everyone (the global switch only, not segments or previews), for
 * what a signed-out visitor may see: nothing public may depend on a flag that only some members have.
 * Pass a service-role client.
 */
export async function isFeatureOnForEveryone(repos: Pick<Repos, "featureFlags">, key: FeatureKey): Promise<boolean> {
  try {
    return await repos.featureFlags.isGloballyEnabled(key);
  } catch (error) {
    throw new Error(`feature_flags read failed: ${error instanceof Error ? error.message : error}`);
  }
}
