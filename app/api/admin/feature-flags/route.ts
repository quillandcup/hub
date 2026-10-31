import { requireAdmin } from "@/lib/supabase/api-auth";
import { FEATURE_PREVIEWS } from "@/lib/features";
import { createRepos } from "@/lib/data/repos";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const repos = createRepos(auth.supabase);

  let flags, links, segments;
  try {
    [flags, links, segments] = await Promise.all([repos.featureFlags.all(), repos.featureFlags.segmentLinks(), repos.segments.list()]);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load feature flags" }, { status: 500 });
  }

  const segmentNameById = new Map(segments.map((s) => [s.id, s.name]));
  const flagByKey = new Map(flags.map((f) => [f.featureKey, f]));
  const segmentsByKey = new Map<string, { id: string; name: string }[]>();
  for (const link of links) {
    const list = segmentsByKey.get(link.featureKey) ?? [];
    list.push({ id: link.segmentId, name: segmentNameById.get(link.segmentId) ?? "(deleted segment)" });
    segmentsByKey.set(link.featureKey, list);
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
    enabledGlobally: flagByKey.get(key)?.enabledGlobally ?? false,
    segments: segmentsByKey.get(key) ?? [],
  }));

  return NextResponse.json({ flags: result });
}
