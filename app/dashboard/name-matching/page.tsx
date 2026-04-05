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

  // Fetch the report data
  const response = await fetch(`${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/api/reports/name-matching`, {
    headers: {
      cookie: `sb-access-token=${(await supabase.auth.getSession()).data.session?.access_token}`,
    },
  });

  let reportData: any = null;
  if (response.ok) {
    reportData = await response.json();
  }

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
        {!reportData ? (
          <div className="text-center py-12">
            <p className="text-slate-600 dark:text-slate-400">Failed to load report</p>
          </div>
        ) : (
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
        )}
      </main>
    </div>
  );
}
