import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import type { FeatureKey } from '@/lib/features';

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
  const supabase = await createClient();

  const [{ data: globalFlags }, { data: previews }, { data: member }] = await Promise.all([
    supabase.from('feature_flags').select('feature_key').eq('enabled_globally', true),
    supabase.from('user_feature_previews').select('feature_key').eq('user_id', userId),
    supabase.from('members').select('id').eq('user_id', userId).maybeSingle(),
  ]);

  const enabled = new Set<string>();
  for (const row of globalFlags ?? []) enabled.add(row.feature_key);
  for (const row of previews ?? []) enabled.add(row.feature_key);

  if (member?.id) {
    const [{ data: segmentLinks }, { data: memberSegments }] = await Promise.all([
      supabase.from('feature_flag_segments').select('feature_key, segment_id'),
      supabase.from('segment_members').select('segment_id').eq('member_id', member.id),
    ]);
    const memberSegmentIds = new Set((memberSegments ?? []).map((row) => row.segment_id));
    for (const row of segmentLinks ?? []) {
      if (memberSegmentIds.has(row.segment_id)) enabled.add(row.feature_key);
    }
  }

  return Array.from(enabled) as FeatureKey[];
});

// Keeps each `.in(...)` URL well under PostgREST's length limit.
const ID_CHUNK = 200;

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += ID_CHUNK) out.push(items.slice(i, i + ID_CHUNK));
  return out;
}

/**
 * Which of these members have `key` on, by the same rules as getUserFeaturePreviews, in a few
 * batched queries (for senders working through many members). Only members with a Hub account
 * count: a flag is per signed-in user, and someone who can't sign in has nothing to see. Pass a
 * service-role client: it reads other users' previews.
 */
export async function membersWithFeature(supabase: any, key: FeatureKey, memberIds: string[]): Promise<Set<string>> {
  const enabled = new Set<string>();
  const unique = [...new Set(memberIds)];
  if (unique.length === 0) return enabled;

  const [{ data: flag }, memberBatches, { data: segmentLinks }] = await Promise.all([
    supabase.from('feature_flags').select('enabled_globally').eq('feature_key', key).maybeSingle(),
    Promise.all(chunks(unique).map((ids) => supabase.from('members').select('id, user_id').in('id', ids))),
    supabase.from('feature_flag_segments').select('segment_id').eq('feature_key', key),
  ]);
  const withAccounts: { id: string; user_id: string }[] = memberBatches
    .flatMap((r: any) => r.data ?? [])
    .filter((m: any) => m.user_id);
  if (flag?.enabled_globally) return new Set(withAccounts.map((m) => m.id));

  const memberByUser = new Map(withAccounts.map((m) => [m.user_id, m.id]));
  const accountMemberIds = withAccounts.map((m) => m.id);
  const segmentIds = (segmentLinks ?? []).map((row: any) => row.segment_id);
  const [previewBatches, segmentBatches] = await Promise.all([
    Promise.all(
      chunks([...memberByUser.keys()]).map((ids) =>
        supabase.from('user_feature_previews').select('user_id').eq('feature_key', key).in('user_id', ids)
      )
    ),
    segmentIds.length === 0
      ? Promise.resolve([])
      : Promise.all(
          chunks(accountMemberIds).map((ids) =>
            supabase.from('segment_members').select('member_id').in('segment_id', segmentIds).in('member_id', ids)
          )
        ),
  ]);
  for (const row of previewBatches.flatMap((r: any) => r.data ?? [])) {
    const memberId = memberByUser.get(row.user_id);
    if (memberId) enabled.add(memberId);
  }
  for (const row of (segmentBatches as any[]).flatMap((r: any) => r.data ?? [])) enabled.add(row.member_id);
  return enabled;
}
