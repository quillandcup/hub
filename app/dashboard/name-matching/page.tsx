import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import MatchingGame from "./MatchingGame";

export default async function NameMatchingReportPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Get active members with their attendance count
  const { data: activeMembers } = await supabase
    .from("members")
    .select(`
      id,
      name,
      email,
      attendance(id)
    `)
    .eq("status", "active")
    .order("name");

  // Filter for members with zero attendance
  const membersWithNoAttendance = activeMembers
    ?.filter(m => !m.attendance || m.attendance.length === 0)
    .map(m => ({
      id: m.id,
      name: m.name,
      email: m.email,
    })) || [];

  // Get unmatched Zoom attendees
  const { data: allZoomNames } = await supabase
    .from("zoom_attendees")
    .select("name, email")
    .order("name");

  const { data: matchedAttendance } = await supabase
    .from("attendance")
    .select(`
      id,
      member_id
    `);

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

  const { data: allMembers } = await supabase
    .from("members")
    .select("id, name, email");

  const memberEmailMap = new Map(allMembers?.map(m => [m.email?.toLowerCase(), m]) || []);

  const unmatchedZoomAttendees: Array<{
    zoomName: string;
    appearances: number;
    emails: string[];
    possibleMatches: Array<{ memberName: string; memberEmail: string }>;
  }> = [];

  for (const [zoomName, info] of zoomNameCounts) {
    let hasMatch = false;
    const possibleMatches: Array<{ memberName: string; memberEmail: string }> = [];

    for (const email of info.emails) {
      const member = memberEmailMap.get(email.toLowerCase());
      if (member && matchedMemberIds.has(member.id)) {
        hasMatch = true;
        break;
      } else if (member && !matchedMemberIds.has(member.id)) {
        possibleMatches.push({
          memberName: member.name,
          memberEmail: member.email,
        });
      }
    }

    if (!hasMatch && info.count >= 3) {
      unmatchedZoomAttendees.push({
        zoomName,
        appearances: info.count,
        emails: Array.from(info.emails),
        possibleMatches,
      });
    }
  }

  unmatchedZoomAttendees.sort((a, b) => b.appearances - a.appearances);

  // Prepare data for the matching game
  const unmatchedAttendeesForGame = unmatchedZoomAttendees.slice(0, 50);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <Link href="/dashboard" className="text-blue-600 dark:text-blue-400 hover:underline mb-2 inline-block">
            ← Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold">Name Matching Report</h1>
          <p className="text-slate-600 dark:text-slate-400 mt-1">
            Identify potential name matching issues and add aliases
          </p>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <MatchingGame
          unmatchedAttendees={unmatchedAttendeesForGame}
          membersWithNoAttendance={membersWithNoAttendance}
        />
      </main>
    </div>
  );
}
