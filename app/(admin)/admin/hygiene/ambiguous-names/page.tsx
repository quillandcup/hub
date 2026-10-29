import { createRepos } from "@/lib/data/repos";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import AmbiguousNamesResolver from "./AmbiguousNamesResolver";
import { requireAdminPage } from "@/lib/admin-auth";
import { matchAttendeeToMember } from "@/lib/member-matching";

export const metadata: Metadata = {
  title: "Ambiguous Zoom Names",
};

export const dynamic = "force-dynamic";

export default async function AmbiguousNamesPage() {
  await requireAdminPage();
  const supabase = await createClient();

  const repos = createRepos(supabase);
  const [{ data: ambiguousRows }, allMembers, aliases, emailAliases] = await Promise.all([
    supabase.from("ambiguous_zoom_names").select("zoom_name, zoom_email").eq("status", "unresolved"),
    repos.members.identities(),
    repos.aliases.nameAliases({ activeOnly: true }),
    repos.aliases.emailAliases({ activeOnly: true }),
  ]);

  const membersById = new Map(allMembers.map((m) => [m.id, { id: m.id, name: m.name, displayName: m.displayName, email: m.email }]));

  // The stored rows are only the queue of names to decide on. Whether a name is still ambiguous,
  // who the candidates are, how often it appears and when it was last seen are worked out here from
  // the current members, aliases and Zoom attendees, so a stored count can't drift and a name that
  // stopped being ambiguous (a member merged or aliased) drops off by itself.
  const attendeeKey = (name: string, email: string | null) => `${name}|${email || ""}`;
  const stillAmbiguous = new Map<string, { zoomName: string; zoomEmail: string | null; candidateIds: string[] }>();
  for (const row of ambiguousRows ?? []) {
    const match = matchAttendeeToMember(row.zoom_name, row.zoom_email, allMembers, aliases, emailAliases);
    if (!match || !("reason" in match)) continue;
    stillAmbiguous.set(attendeeKey(row.zoom_name, row.zoom_email), {
      zoomName: row.zoom_name,
      zoomEmail: row.zoom_email,
      candidateIds: match.candidates.map((c) => c.id),
    });
  }

  const usage = new Map<string, { count: number; lastSeenAt: string }>();
  const names = [...new Set([...stillAmbiguous.values()].map((r) => r.zoomName))];
  if (names.length > 0) {
    const BATCH_SIZE = 1000;
    let offset = 0;
    let hasMore = true;
    while (hasMore) {
      const { data: batch, error } = await supabase
        .schema("bronze")
        .from("zoom_attendees")
        .select("name, email, join_time")
        .in("name", names)
        .order("id")
        .range(offset, offset + BATCH_SIZE - 1);
      if (error) throw error;
      for (const a of batch ?? []) {
        const key = attendeeKey(a.name, a.email);
        const seen = usage.get(key) ?? { count: 0, lastSeenAt: "" };
        seen.count++;
        if (a.join_time > seen.lastSeenAt) seen.lastSeenAt = a.join_time;
        usage.set(key, seen);
      }
      offset += batch?.length ?? 0;
      hasMore = (batch?.length ?? 0) === BATCH_SIZE;
    }
  }

  // Group by zoom_name only: the same bare name can be stored with and without an email.
  const groups = new Map<string, { occurrenceCount: number; lastSeenAt: string; candidateIds: Set<string> }>();
  for (const [key, row] of stillAmbiguous) {
    const seen = usage.get(key);
    const group = groups.get(row.zoomName) ?? { occurrenceCount: 0, lastSeenAt: "", candidateIds: new Set<string>() };
    group.occurrenceCount += seen?.count ?? 0;
    if ((seen?.lastSeenAt ?? "") > group.lastSeenAt) group.lastSeenAt = seen!.lastSeenAt;
    for (const id of row.candidateIds) group.candidateIds.add(id);
    groups.set(row.zoomName, group);
  }

  const entries = Array.from(groups.entries())
    .map(([zoomName, g]) => ({
      zoomName,
      occurrenceCount: g.occurrenceCount,
      lastSeenAt: g.lastSeenAt,
      candidates: Array.from(g.candidateIds)
        .map((id) => membersById.get(id))
        .filter((m): m is { id: string; name: string; displayName: string | null; email: string } => !!m),
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
