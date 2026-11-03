import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/supabase/api-auth';
import { createRepos } from '@/lib/data/repos';
import { FEATURE_PREVIEWS, type FeatureKey } from '@/lib/features';
import { withAction } from "@/lib/analytics/server";
import { responseOutcome } from "@/lib/analytics/outcome";

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth.forbidden) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const features = await createRepos(auth.supabase).featureFlags.previewKeys(auth.user!.id);

  return NextResponse.json({ features });
}

async function handlePost(request: NextRequest) {
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

// Usage analytics: each action records whether it worked (lib/analytics/server.ts).
export async function POST(...args: Parameters<typeof handlePost>): Promise<Response> {
  return withAction("feature_preview_changed", async () => (await handlePost(...args)) as Response, responseOutcome);
}
