import { requireAdmin } from "@/lib/supabase/api-auth";
import { FEATURE_PREVIEWS } from "@/lib/features";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  const [{ data: flags, error }, { data: links }, { data: segments }] = await Promise.all([
    supabase.from("feature_flags").select("feature_key, enabled_globally"),
    supabase.from("feature_flag_segments").select("feature_key, segment_id"),
    supabase.from("segments").select("id, name"),
  ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const segmentNameById = new Map((segments ?? []).map((s) => [s.id, s.name]));
  const flagByKey = new Map((flags ?? []).map((f) => [f.feature_key, f]));
  const segmentsByKey = new Map<string, { id: string; name: string }[]>();
  for (const link of links ?? []) {
    const list = segmentsByKey.get(link.feature_key) ?? [];
    list.push({ id: link.segment_id, name: segmentNameById.get(link.segment_id) ?? "(deleted segment)" });
    segmentsByKey.set(link.feature_key, list);
  }

  const nameByKey = new Map<string, string>(FEATURE_PREVIEWS.map((f) => [f.key, f.name]));

  // Every key in FEATURE_PREVIEWS gets a row even if feature_flags hasn't
  // been backfilled for it yet (defaults to off/unlinked), plus any key
  // that only exists as a feature_flags/feature_flag_segments row (e.g.
  // attached to a segment before it shipped in FEATURE_PREVIEWS).
  const allKeys = new Set<string>([...nameByKey.keys(), ...flagByKey.keys(), ...segmentsByKey.keys()]);

  const result = Array.from(allKeys).map((key) => ({
    key,
    name: nameByKey.get(key) ?? key,
    enabledGlobally: flagByKey.get(key)?.enabled_globally ?? false,
    segments: segmentsByKey.get(key) ?? [],
  }));

  return NextResponse.json({ flags: result });
}
