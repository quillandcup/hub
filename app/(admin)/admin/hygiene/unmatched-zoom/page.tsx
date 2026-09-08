import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import AliasSearchForm from "./AliasSearchForm";
import { computeUnmatchedZoomNames } from "@/lib/unmatched-zoom-names";

export const metadata: Metadata = {
  title: "Unmatched Zoom Names",
};

export default async function AliasSearchPage() {
  const supabase = await createClient();

  // Get members, aliases, ignored names, and staff in parallel; paginate zoom_attendees separately
  const [
    { data: allMembers },
    { data: aliases },
    { data: ignoredNames },
    { data: staffMembers },
  ] = await Promise.all([
    supabase.from("members").select("id, name, email").order("name"),
    supabase.from("member_name_aliases").select("alias, member_id, source"),
    supabase.from("ignored_zoom_names").select("zoom_name"),
    supabase.from("staff").select("name, email"),
  ]);

  // Paginate zoom_attendees — table exceeds 1000 rows
  const allZoomNames: { name: string; email: string | null; meeting_uuid: string }[] = [];
  {
    const BATCH = 1000;
    let offset = 0, hasMore = true;
    while (hasMore) {
      const { data: batch } = await supabase
        .schema('bronze').from("zoom_attendees")
        .select("name, email, meeting_uuid")
        .range(offset, offset + BATCH - 1);
      if (batch && batch.length > 0) {
        allZoomNames.push(...batch);
        offset += batch.length;
        hasMore = batch.length === BATCH;
      } else {
        hasMore = false;
      }
    }
  }

  const unmatchedZoomAttendees = computeUnmatchedZoomNames(
    allZoomNames || [],
    allMembers || [],
    aliases || [],
    (ignoredNames || []).map((i) => i.zoom_name),
    staffMembers || []
  ).sort((a, b) => b.appearances - a.appearances);

  return (
    <div className="container mx-auto px-6 py-8">
      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Unmatched Zoom Names</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
          Create aliases to match Zoom names to members using search
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-500 mt-2">
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
