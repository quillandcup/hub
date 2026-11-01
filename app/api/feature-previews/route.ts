import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/supabase/api-auth';
import { createRepos } from '@/lib/data/repos';
import { FEATURE_PREVIEWS, type FeatureKey } from '@/lib/features';

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth.forbidden) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const features = await createRepos(auth.supabase).featureFlags.previewKeys(auth.user!.id);

  return NextResponse.json({ features });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth.forbidden) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const parsed = await request.json().catch(() => undefined);
  if (parsed === undefined) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const body = parsed;
  const { feature, enabled } = body as { feature: FeatureKey; enabled: boolean };

  if (!FEATURE_PREVIEWS.find((f) => f.key === feature)) {
    return NextResponse.json({ error: 'Invalid feature key' }, { status: 400 });
  }

  await createRepos(auth.supabase).featureFlags.setPreview(auth.user!.id, feature, Boolean(enabled));

  return NextResponse.json({ success: true });
}
