import { createRepos } from "@/lib/data/repos";
import type { Db } from "@/lib/data/db";
import type { IgnoredAppearance } from "@/lib/unmatched-zoom-names";

/**
 * Zoom names ignored for one prickle only, each with that prickle's time window, so the
 * all-time unmatched list can drop just those appearances (a prickle's attendees are the
 * ones whose join/leave overlaps its window, as on the prickle page).
 */
export async function loadIgnoredAppearances(supabase: Db): Promise<IgnoredAppearance[]> {
  const { data, error } = await supabase.from("ignored_zoom_appearances").select("zoom_name, prickle_id");
  if (error) throw new Error(`Failed to load per-prickle Zoom ignores: ${error.message}`);
  if (!data || data.length === 0) return [];

  const prickles = await createRepos(supabase).prickles.byIds([...new Set(data.map((r) => r.prickle_id))]);
  const windows = new Map(prickles.map((p) => [p.id, p]));
  return data.flatMap((r) => {
    const p = windows.get(r.prickle_id);
    return p ? [{ zoomName: r.zoom_name, startTime: p.startTime, endTime: p.endTime }] : [];
  });
}
