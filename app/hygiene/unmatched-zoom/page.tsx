import { createClient } from "@/lib/supabase/server";
import AliasSearchForm from "./AliasSearchForm";
import { matchAttendeeToMember } from "@/lib/member-matching";

export default async function AliasSearchPage() {
  const supabase = await createClient();

  //Get all members, aliases, ignored names, and zoom names in parallel
  const [
    { data: allMembers },
    { data: aliases },
    { data: ignoredNames },
    { data: allZoomNames },
  ] = await Promise.all([
    supabase
      .from("members")
      .select("id, name, email, status")
      .order("name"),
    supabase
      .from("member_name_aliases")
      .select("alias, member_id"),
    supabase
      .from("ignored_zoom_names")
      .select("zoom_name"),
    supabase
      .from("zoom_attendees")
      .select("name, email, meeting_uuid")
      .order("name"),
  ]);

  const ignoredSet = new Set(ignoredNames?.map(i => i.zoom_name) || []);

  // Count unique meetings (not total records) for each Zoom name
  const zoomNameCounts = new Map<string, { count: number; emails: Set<string>; meetings: Set<string> }>();
  allZoomNames?.forEach(z => {
    const existing = zoomNameCounts.get(z.name);
    if (existing) {
      if (z.meeting_uuid) existing.meetings.add(z.meeting_uuid);
      if (z.email) existing.emails.add(z.email);
    } else {
      zoomNameCounts.set(z.name, {
        count: 0, // Will be set to meetings.size below
        emails: new Set(z.email ? [z.email] : []),
        meetings: new Set(z.meeting_uuid ? [z.meeting_uuid] : []),
      });
    }
  });

  // Update counts to be unique meetings
  for (const [name, info] of zoomNameCounts) {
    info.count = info.meetings.size;
  }

  const unmatchedZoomAttendees: Array<{
    zoomName: string;
    appearances: number;
    emails: string[];
  }> = [];

  // Check each Zoom name to see if it can be matched
  for (const [zoomName, info] of zoomNameCounts) {
    // Skip ignored names
    if (ignoredSet.has(zoomName)) continue;

    // Use centralized matching logic to check if this would match
    const email = info.emails.size > 0 ? Array.from(info.emails)[0] : null;
    const matchResult = matchAttendeeToMember(
      zoomName,
      email,
      allMembers || [],
      aliases || []
    );

    // If no match found, add to unmatched list
    if (!matchResult) {
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
