import { requireAdmin } from "@/lib/supabase/api-auth";
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
  const { segmentId } = await request.json();

  if (!segmentId) {
    return NextResponse.json({ error: "segmentId is required" }, { status: 400 });
  }

  // Ensure the flag has a registry row (defaults to off) so the FK on
  // feature_flag_segments.feature_key is satisfiable even for a key that
  // hasn't been toggled globally yet.
  await supabase.from("feature_flags").upsert({ feature_key: key }, { onConflict: "feature_key", ignoreDuplicates: true });

  const { error } = await supabase
    .from("feature_flag_segments")
    .upsert({ feature_key: key, segment_id: segmentId }, { onConflict: "feature_key,segment_id" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
