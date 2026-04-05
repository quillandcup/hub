import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import SignOutButton from "./SignOutButton";

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Fetch dashboard metrics
  const { data: memberStats } = await supabase
    .from("members")
    .select("status");

  const activeMembers = memberStats?.filter(m => m.status === "active").length || 0;
  const onHiatus = memberStats?.filter(m => m.status === "on_hiatus").length || 0;
  const inactive = memberStats?.filter(m => m.status === "inactive").length || 0;
  const totalMembers = activeMembers + onHiatus; // Exclude inactive (cancelled members)

  // Prickles in last 30 days (past only, exclude future)
  const now = new Date();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const { data: recentPrickles } = await supabase
    .from("prickles")
    .select("id")
    .gte("start_time", thirtyDaysAgo.toISOString())
    .lte("start_time", now.toISOString());

  const pricklesLast30Days = recentPrickles?.length || 0;

  // Total attendance records
  const { count: totalAttendance } = await supabase
    .from("attendance")
    .select("*", { count: "exact", head: true });

  // At-risk: active members with no attendance in last 30 days
  const { data: atRiskMembers } = await supabase
    .from("members")
    .select(`
      id,
      name,
      email,
      attendance(join_time)
    `)
    .eq("status", "active");

  const atRisk = atRiskMembers?.filter(m => {
    // No attendance at all, or no recent attendance
    if (!m.attendance || m.attendance.length === 0) {
      return true;
    }
    const hasRecentAttendance = m.attendance.some((a: any) =>
      new Date(a.join_time) >= thirtyDaysAgo
    );
    return !hasRecentAttendance;
  }).length || 0;

  // Top 10 most active members (all time)
  const { data: topAttendees } = await supabase
    .from("attendance")
    .select(`
      member_id,
      members!inner(name, email)
    `)
    .limit(1000);

  // Count attendance per member
  const attendanceCounts = new Map<string, { name: string; email: string; count: number }>();
  topAttendees?.forEach((a: any) => {
    const existing = attendanceCounts.get(a.member_id);
    if (existing) {
      existing.count++;
    } else {
      attendanceCounts.set(a.member_id, {
        name: a.members.name,
        email: a.members.email,
        count: 1,
      });
    }
  });

  const topAttendeesData = Array.from(attendanceCounts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // At-risk members list (active with no attendance in 30 days)
  const atRiskMembersList = atRiskMembers?.filter(m => {
    // No attendance at all, or no recent attendance
    if (!m.attendance || m.attendance.length === 0) {
      return true;
    }
    const hasRecentAttendance = m.attendance.some((a: any) =>
      new Date(a.join_time) >= thirtyDaysAgo
    );
    return !hasRecentAttendance;
  }).slice(0, 10) || [];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            Quill & Cup Admin
          </h1>
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard/import"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
            >
              Import Data
            </Link>
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        {/* Top Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <MetricCard
            label="Total Members"
            value={totalMembers}
            description={`${activeMembers} active, ${onHiatus} on hiatus`}
          />
          <MetricCard
            label="Prickles (30d)"
            value={pricklesLast30Days}
            description="Sessions this month"
          />
          <MetricCard
            label="Total Attendance"
            value={totalAttendance || 0}
            description="All-time records"
          />
          <MetricCard
            label="At Risk"
            value={atRisk}
            description="Active but not attending"
            highlighted
          />
        </div>

        {/* Hedgie Welcome */}
        <div className="bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 rounded-lg p-6 mb-8 flex items-center gap-6">
          <img
            src="/hedgie-admin.png"
            alt="Hedgie Administrator"
            className="w-32 h-32 rounded-lg shadow-lg"
          />
          <div>
            <h2 className="text-2xl font-bold mb-2">Welcome to Hedgie HQ! 🦔</h2>
            <p className="text-slate-600 dark:text-slate-300">
              Your command center for tracking Prickles attendance, member engagement, and community insights.
            </p>
          </div>
        </div>

        {/* Engagement Insights */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          {/* Top Attendees */}
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
            <h2 className="text-xl font-bold mb-4">🌟 Top Attendees</h2>
            <div className="space-y-3">
              {topAttendeesData.map((member, idx) => (
                <div key={idx} className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800 last:border-0">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-sm font-bold text-blue-600 dark:text-blue-400">
                      {idx + 1}
                    </div>
                    <div>
                      <div className="font-semibold text-slate-900 dark:text-slate-100">{member.name}</div>
                      <div className="text-sm text-slate-500 dark:text-slate-400">{member.email}</div>
                    </div>
                  </div>
                  <div className="text-lg font-bold text-blue-600 dark:text-blue-400">
                    {member.count}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* At-Risk Members */}
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">⚠️ At-Risk Members</h2>
              {atRiskMembersList.length > 0 && (
                <Link href="/dashboard/at-risk" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
                  View All ({atRisk})
                </Link>
              )}
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
              Active members with no attendance in last 30 days
            </p>
            <div className="space-y-3">
              {atRiskMembersList.length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                  No at-risk members! 🎉
                </div>
              ) : (
                atRiskMembersList.map((member: any, idx: number) => (
                  <div key={idx} className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800 last:border-0">
                    <div>
                      <div className="font-semibold text-slate-900 dark:text-slate-100">{member.name}</div>
                      <div className="text-sm text-slate-500 dark:text-slate-400">{member.email}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Navigation Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
          <Link href="/dashboard/members">
            <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6 hover:shadow-lg transition-shadow cursor-pointer">
              <h2 className="text-xl font-bold mb-2">Member Analytics</h2>
              <p className="text-slate-600 dark:text-slate-400 mb-4">
                View member engagement, risk levels, and activity history
              </p>
              <div className="flex items-center text-blue-600 dark:text-blue-400">
                <span>View Members</span>
                <span className="ml-2">→</span>
              </div>
            </div>
          </Link>

          <Link href="/dashboard/prickles">
            <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6 hover:shadow-lg transition-shadow cursor-pointer">
              <h2 className="text-xl font-bold mb-2">Prickle Insights</h2>
              <p className="text-slate-600 dark:text-slate-400 mb-4">
                Analyze Prickle popularity, trends, and attendance patterns
              </p>
              <div className="flex items-center text-blue-600 dark:text-blue-400">
                <span>View Prickles</span>
                <span className="ml-2">→</span>
              </div>
            </div>
          </Link>

          <Link href="/dashboard/calendar">
            <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6 hover:shadow-lg transition-shadow cursor-pointer">
              <h2 className="text-xl font-bold mb-2">Calendar Heatmap</h2>
              <p className="text-slate-600 dark:text-slate-400 mb-4">
                Week view of Prickles color-coded by attendance
              </p>
              <div className="flex items-center text-blue-600 dark:text-blue-400">
                <span>View Calendar</span>
                <span className="ml-2">→</span>
              </div>
            </div>
          </Link>

          <Link href="/dashboard/import">
            <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6 hover:shadow-lg transition-shadow cursor-pointer">
              <h2 className="text-xl font-bold mb-2">Import Data</h2>
              <p className="text-slate-600 dark:text-slate-400 mb-4">
                Import Zoom meeting attendance data into the system
              </p>
              <div className="flex items-center text-blue-600 dark:text-blue-400">
                <span>Import Zoom Data</span>
                <span className="ml-2">→</span>
              </div>
            </div>
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <Link href="/dashboard/name-matching">
            <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6 hover:shadow-lg transition-shadow cursor-pointer">
              <h2 className="text-xl font-bold mb-2">Name Matching</h2>
              <p className="text-slate-600 dark:text-slate-400 mb-4">
                Find members with no attendance and unmatched Zoom names
              </p>
              <div className="flex items-center text-blue-600 dark:text-blue-400">
                <span>View Report</span>
                <span className="ml-2">→</span>
              </div>
            </div>
          </Link>
        </div>
      </main>
    </div>
  );
}

function MetricCard({ label, value, description, highlighted }: { label: string; value: number; description: string; highlighted?: boolean }) {
  return (
    <div className={`bg-white dark:bg-slate-900 rounded-lg shadow p-6 ${highlighted ? 'ring-2 ring-red-500' : ''}`}>
      <div className={`text-4xl font-bold mb-2 ${highlighted ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'}`}>
        {value}
      </div>
      <div className="font-semibold text-slate-900 dark:text-slate-100 mb-1">{label}</div>
      <div className="text-sm text-slate-500 dark:text-slate-400">{description}</div>
    </div>
  );
}
