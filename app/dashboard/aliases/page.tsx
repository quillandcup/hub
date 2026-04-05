import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import AliasSearchForm from "./AliasSearchForm";

export default async function AliasSearchPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Get all members for search
  const { data: allMembers } = await supabase
    .from("members")
    .select("id, name, email, status")
    .order("name");

  // Get unmatched Zoom attendees
  const { data: allZoomNames } = await supabase
    .from("zoom_attendees")
    .select("name, email")
    .order("name");

  const { data: matchedAttendance } = await supabase
    .from("attendance")
    .select("id, member_id");

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

  const matchedMemberIds = new Set(matchedAttendance?.map(a => a.member_id) || []);

  const { data: allMembersForEmailMatch } = await supabase
    .from("members")
    .select("id, name, email");

  const memberEmailMap = new Map(
    allMembersForEmailMatch?.map(m => [m.email?.toLowerCase(), m]) || []
  );

  const unmatchedZoomAttendees: Array<{
    zoomName: string;
    appearances: number;
    emails: string[];
  }> = [];

  for (const [zoomName, info] of zoomNameCounts) {
    let hasMatch = false;

    for (const email of info.emails) {
      const member = memberEmailMap.get(email.toLowerCase());
      if (member && matchedMemberIds.has(member.id)) {
        hasMatch = true;
        break;
      }
    }

    if (!hasMatch && info.count >= 3) {
      unmatchedZoomAttendees.push({
        zoomName,
        appearances: info.count,
        emails: Array.from(info.emails),
      });
    }
  }

  unmatchedZoomAttendees.sort((a, b) => b.appearances - a.appearances);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <Link href="/dashboard" className="text-blue-600 dark:text-blue-400 hover:underline mb-2 inline-block">
            ← Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold">Create Aliases with Search</h1>
          <p className="text-slate-600 dark:text-slate-400 mt-1">
            Match Zoom names to any member using search
          </p>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <AliasSearchForm
          unmatchedAttendees={unmatchedZoomAttendees}
          allMembers={allMembers || []}
        />
      </main>
    </div>
  );
}
