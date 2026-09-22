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
 * feature keys exist — never a per-flag round trip.
 */
export async function getUserFeaturePreviews(userId: string): Promise<FeatureKey[]> {
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
}
