import { createClient } from '@/lib/supabase/server';
import type { FeatureKey } from '@/lib/features';

export async function getUserFeaturePreviews(userId: string): Promise<FeatureKey[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('user_feature_previews')
    .select('feature_key')
    .eq('user_id', userId);
  return (data ?? []).map((row) => row.feature_key as FeatureKey);
}
