import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import AliasSearchForm from "./AliasSearchForm";
import { matchAttendeeToMember } from "@/lib/member-matching";

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

  const ignoredSet = new Set(ignoredNames?.map(i => i.zoom_name) || []);
  const staffEmails = new Set((staffMembers || []).map(s => s.email.toLowerCase()));
  const staffNames = new Set((staffMembers || []).map(s => s.name.toLowerCase()));

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

    // Skip staff members — they attend but aren't tracked as members
    const zoomEmail = info.emails.size > 0 ? Array.from(info.emails)[0]?.toLowerCase() : null;
    if (staffNames.has(zoomName.toLowerCase()) || (zoomEmail && staffEmails.has(zoomEmail))) continue;

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
