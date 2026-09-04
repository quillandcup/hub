import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import AmbiguousNamesResolver from "./AmbiguousNamesResolver";

export const metadata: Metadata = {
  title: "Ambiguous Zoom Names",
};

export const dynamic = "force-dynamic";

export default async function AmbiguousNamesPage() {
  const supabase = await createClient();

  const [{ data: ambiguousRows }, { data: allMembers }] = await Promise.all([
    supabase
      .from("ambiguous_zoom_names")
      .select("zoom_name, candidate_member_ids, occurrence_count, last_seen_at")
      .eq("status", "unresolved"),
    supabase.from("members").select("id, name, email").order("name"),
  ]);

  const membersById = new Map((allMembers ?? []).map((m) => [m.id, m]));

  // Group by zoom_name only -- UNIQUE(zoom_name, zoom_email) doesn't dedupe when
  // zoom_email is NULL (Postgres treats each NULL as distinct), so the same bare
  // name can show up as several identical unresolved rows.
  const groups = new Map<
    string,
    { occurrenceCount: number; lastSeenAt: string; candidateIds: Set<string> }
  >();
  for (const row of ambiguousRows ?? []) {
    const existing = groups.get(row.zoom_name);
    if (existing) {
      existing.occurrenceCount += row.occurrence_count ?? 0;
      if (row.last_seen_at > existing.lastSeenAt) existing.lastSeenAt = row.last_seen_at;
      for (const id of row.candidate_member_ids ?? []) existing.candidateIds.add(id);
    } else {
      groups.set(row.zoom_name, {
        occurrenceCount: row.occurrence_count ?? 0,
        lastSeenAt: row.last_seen_at,
        candidateIds: new Set<string>(row.candidate_member_ids ?? []),
      });
    }
  }

  const entries = Array.from(groups.entries())
    .map(([zoomName, g]) => ({
      zoomName,
      occurrenceCount: g.occurrenceCount,
      lastSeenAt: g.lastSeenAt,
      candidates: Array.from(g.candidateIds)
        .map((id) => membersById.get(id))
        .filter((m): m is { id: string; name: string; email: string } => !!m),
    }))
    .sort((a, b) => b.occurrenceCount - a.occurrenceCount);

  return (
    <div className="container mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Ambiguous Zoom Names</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
          These Zoom display names matched more than one member, so attendance processing
          skipped them entirely — no attendance record was written for anyone, silently
          producing false no-shows. Assign each name to the member it actually belongs to.
        </p>
      </div>

      <AmbiguousNamesResolver entries={entries} />
    </div>
  );
}
