import { requireAdmin } from "@/lib/supabase/api-auth";
import { createRepos } from "@/lib/data/repos";
import { NextRequest, NextResponse } from "next/server";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  const { key } = await params;
  const parsed = await request.json().catch(() => undefined);
  if (parsed === undefined) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const { segmentId } = parsed;

  if (!segmentId) {
    return NextResponse.json({ error: "segmentId is required" }, { status: 400 });
  }

  // linkSegment also gives the flag a registry row (off) if it has none, so the foreign key is
  // satisfiable even for a key that hasn't been toggled globally yet.
  try {
    await createRepos(supabase).featureFlags.linkSegment(key, segmentId);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not link the segment" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
