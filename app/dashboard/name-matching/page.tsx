import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

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

  const reportData = {
    success: true,
    membersWithNoAttendance: {
      count: membersWithNoAttendance.length,
      members: membersWithNoAttendance,
    },
    unmatchedZoomAttendees: {
      count: unmatchedZoomAttendees.length,
      attendees: unmatchedZoomAttendees.slice(0, 50),
    },
  };

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
        <div className="space-y-6">
            {/* Active Members with No Attendance */}
            <div className="bg-white dark:bg-slate-900 rounded-lg shadow">
              <div className="p-6 border-b border-slate-200 dark:border-slate-800">
                <h2 className="text-xl font-bold">Active Members with No Attendance</h2>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                  These members are marked active but have no attendance records. They may use a different name in Zoom.
                </p>
                <div className="mt-2">
                  <span className="text-2xl font-bold text-orange-600 dark:text-orange-400">
                    {reportData.membersWithNoAttendance.count}
                  </span>
                  <span className="text-sm text-slate-600 dark:text-slate-400 ml-2">members</span>
                </div>
              </div>

              <div className="divide-y divide-slate-200 dark:divide-slate-800">
                {reportData.membersWithNoAttendance.members.length === 0 ? (
                  <div className="p-12 text-center text-slate-500">
                    All active members have attendance! 🎉
                  </div>
                ) : (
                  reportData.membersWithNoAttendance.members.map((member: any) => (
                    <div key={member.id} className="p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        {member.name}
                      </div>
                      <div className="text-sm text-slate-600 dark:text-slate-400">
                        {member.email}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Unmatched Zoom Attendees */}
            <div className="bg-white dark:bg-slate-900 rounded-lg shadow">
              <div className="p-6 border-b border-slate-200 dark:border-slate-800">
                <h2 className="text-xl font-bold">Frequent Unmatched Zoom Attendees</h2>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                  Names appearing 3+ times in Zoom that didn't match to any member. These may be guests or name variations.
                </p>
                <div className="mt-2">
                  <span className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                    {reportData.unmatchedZoomAttendees.count}
                  </span>
                  <span className="text-sm text-slate-600 dark:text-slate-400 ml-2">unique names</span>
                </div>
              </div>

              <div className="divide-y divide-slate-200 dark:divide-slate-800">
                {reportData.unmatchedZoomAttendees.attendees.length === 0 ? (
                  <div className="p-12 text-center text-slate-500">
                    All frequent Zoom attendees matched! 🎉
                  </div>
                ) : (
                  reportData.unmatchedZoomAttendees.attendees.map((attendee: any, idx: number) => (
                    <div key={idx} className="p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="font-semibold text-slate-900 dark:text-slate-100">
                            {attendee.zoomName}
                          </div>
                          <div className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                            Appeared {attendee.appearances} times
                          </div>
                          {attendee.emails.length > 0 && (
                            <div className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                              Emails: {attendee.emails.join(", ")}
                            </div>
                          )}
                          {attendee.possibleMatches.length > 0 && (
                            <div className="mt-2 text-sm">
                              <span className="text-orange-600 dark:text-orange-400 font-medium">
                                Possible match:
                              </span>
                              {attendee.possibleMatches.map((match: any, i: number) => (
                                <div key={i} className="ml-4 text-slate-600 dark:text-slate-400">
                                  {match.memberName} ({match.memberEmail})
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
      </main>
    </div>
  );
}
