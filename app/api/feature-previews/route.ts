import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/supabase/api-auth';
import { FEATURE_PREVIEWS, type FeatureKey } from '@/lib/features';

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth.forbidden) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data } = await auth.supabase
    .from('user_feature_previews')
    .select('feature_key')
    .eq('user_id', auth.user!.id);

  return NextResponse.json({ features: (data ?? []).map((r) => r.feature_key) });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth.forbidden) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json();
  const { feature, enabled } = body as { feature: FeatureKey; enabled: boolean };

  if (!FEATURE_PREVIEWS.find((f) => f.key === feature)) {
    return NextResponse.json({ error: 'Invalid feature key' }, { status: 400 });
  }

  const userId = auth.user!.id;

  if (enabled) {
    await auth.supabase
      .from('user_feature_previews')
      .upsert({ user_id: userId, feature_key: feature }, { onConflict: 'user_id,feature_key' });
  } else {
    await auth.supabase
      .from('user_feature_previews')
      .delete()
      .eq('user_id', userId)
      .eq('feature_key', feature);
  }

  return NextResponse.json({ success: true });
}
