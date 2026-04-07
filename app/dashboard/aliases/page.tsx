import { createClient } from "@/lib/supabase/server";
import AliasSearchForm from "./AliasSearchForm";

export default async function AliasSearchPage() {
  const supabase = await createClient();

  // Get all members for search
  const { data: allMembers } = await supabase
    .from("members")
    .select("id, name, email, status")
    .order("name");

  // Get unmatched Zoom attendees - those that don't match any member
  const { data: allZoomNames } = await supabase
    .from("zoom_attendees")
    .select("name, email")
    .order("name");

  // Count how many times each Zoom name appears
  const zoomNameCounts = new Map<string, { count: number; emails: Set<string> }>();
  allZoomNames?.forEach(z => {
    const existing = zoomNameCounts.get(z.name);
    if (existing) {
      existing.count++;
      if (z.email) existing.emails.add(z.email);
    } else {
      zoomNameCounts.set(z.name, {
        count: 1,
        emails: new Set(z.email ? [z.email] : []),
      });
    }
  });

  const unmatchedZoomAttendees: Array<{
    zoomName: string;
    appearances: number;
    emails: string[];
  }> = [];

  // Check each Zoom name to see if it can be matched
  for (const [zoomName, info] of zoomNameCounts) {
    // Use the actual matching function to check if this would match
    const email = info.emails.size > 0 ? Array.from(info.emails)[0] : null;
    const { data: matchResult } = await supabase.rpc("match_member_by_name", {
      zoom_name: zoomName,
      zoom_email: email,
    });

    // If no match found, add to unmatched list
    if (!matchResult || matchResult.length === 0) {
      unmatchedZoomAttendees.push({
        zoomName,
        appearances: info.count,
        emails: Array.from(info.emails),
      });
    }
  }

  unmatchedZoomAttendees.sort((a, b) => b.appearances - a.appearances);

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
