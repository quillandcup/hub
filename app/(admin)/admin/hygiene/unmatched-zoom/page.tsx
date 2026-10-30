import { createRepos } from "@/lib/data/repos";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import AliasSearchForm from "./AliasSearchForm";
import { computeUnmatchedZoomNames } from "@/lib/unmatched-zoom-names";
import { loadIgnoredAppearances } from "@/lib/ignored-zoom-appearances";
import { requireAdminPage } from "@/lib/admin-auth";

export const metadata: Metadata = {
  title: "Unmatched Zoom Names",
};

export default async function AliasSearchPage() {
  await requireAdminPage();
  const supabase = await createClient();

  // Get members, aliases, ignored names, and staff in parallel; paginate zoom_attendees separately
  const [
    allMembers,
    aliases,
    ignoredNames,
    { data: staffMembers },
  ] = await Promise.all([
    createRepos(supabase).members.identities(),
    createRepos(supabase).aliases.nameAliases(),
    createRepos(supabase).zoom.ignoredNames(),
    supabase.from("staff").select("name, email"),
  ]);

  // The repository pages through zoom_attendees (the table exceeds 1000 rows)
  const allZoomNames = await createRepos(supabase).zoom.attendeesForMatching();

  const unmatchedZoomAttendees = computeUnmatchedZoomNames(
    allZoomNames || [],
    allMembers || [],
    aliases || [],
    ignoredNames,
    staffMembers || [],
    await loadIgnoredAppearances(supabase)
  ).sort((a, b) => b.appearances - a.appearances);

  return (
    <div className="container mx-auto px-6 py-8">
      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Unmatched Zoom Names</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
          Create aliases to match Zoom names to members using search
        </p>
        <p className="text-xs text-slate-600 dark:text-slate-400 mt-2">
          Showing all unmatched Zoom names from your data.
          Check for trailing spaces, typos, or unusual characters.
        </p>
      </div>

      <AliasSearchForm
        unmatchedAttendees={unmatchedZoomAttendees}
        allMembers={allMembers || []}
      />
    </div>
  );
}
