import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function AtRiskPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Get all active members with their attendance
  const { data: activeMembers } = await supabase
    .from("members")
    .select(`
      id,
      name,
      email,
      joined_at,
      attendance(join_time)
    `)
    .eq("status", "active")
    .order("name");

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // Filter for at-risk members
  const atRiskMembers = activeMembers?.filter(m => {
    // No attendance at all, or no recent attendance
    if (!m.attendance || m.attendance.length === 0) {
      return true;
    }
    const hasRecentAttendance = m.attendance.some((a: any) =>
      new Date(a.join_time) >= thirtyDaysAgo
    );
    return !hasRecentAttendance;
  }) || [];

  // Calculate stats for each member
  const membersWithStats = atRiskMembers.map(m => {
    const totalAttendance = m.attendance?.length || 0;
    const lastAttendance = m.attendance && m.attendance.length > 0
      ? new Date(Math.max(...m.attendance.map((a: any) => new Date(a.join_time).getTime())))
      : null;

    return {
      ...m,
      totalAttendance,
      lastAttendance,
      daysSinceLastAttendance: lastAttendance
        ? Math.floor((Date.now() - lastAttendance.getTime()) / (1000 * 60 * 60 * 24))
        : null,
    };
  });

  // Sort by days since last attendance (descending), then by name
  membersWithStats.sort((a, b) => {
    if (a.daysSinceLastAttendance === null && b.daysSinceLastAttendance === null) {
      return a.name.localeCompare(b.name);
    }
    if (a.daysSinceLastAttendance === null) return -1;
    if (b.daysSinceLastAttendance === null) return 1;
    return b.daysSinceLastAttendance - a.daysSinceLastAttendance;
  });

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <Link href="/dashboard" className="text-blue-600 dark:text-blue-400 hover:underline mb-2 inline-block">
            ← Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold">⚠️ At-Risk Members</h1>
          <p className="text-slate-600 dark:text-slate-400 mt-1">
            Active members with no attendance in the last 30 days
          </p>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow">
          <div className="p-6 border-b border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-3xl font-bold text-red-600 dark:text-red-400">
                  {atRiskMembers.length}
                </div>
                <div className="text-sm text-slate-600 dark:text-slate-400">
                  members need outreach
                </div>
              </div>
            </div>
          </div>

          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {membersWithStats.length === 0 ? (
              <div className="p-12 text-center text-slate-500">
                No at-risk members! 🎉
              </div>
            ) : (
              membersWithStats.map((member) => (
                <div key={member.id} className="p-6 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <Link
                        href={`/dashboard/members/${member.id}`}
                        className="font-semibold text-lg text-slate-900 dark:text-slate-100 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                      >
                        {member.name}
                      </Link>
                      <div className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                        {member.email}
                      </div>
                      <div className="flex gap-4 mt-3 text-sm">
                        <div>
                          <span className="text-slate-500 dark:text-slate-400">Total attendance:</span>{" "}
                          <span className="font-semibold">{member.totalAttendance}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 dark:text-slate-400">Joined:</span>{" "}
                          <span className="font-semibold">
                            {new Date(member.joined_at).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="text-right ml-4">
                      {member.daysSinceLastAttendance === null ? (
                        <div className="px-3 py-1 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 text-sm font-semibold">
                          Never attended
                        </div>
                      ) : (
                        <div className="text-slate-900 dark:text-slate-100">
                          <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">
                            {member.daysSinceLastAttendance}
                          </div>
                          <div className="text-sm text-slate-600 dark:text-slate-400">
                            days ago
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
