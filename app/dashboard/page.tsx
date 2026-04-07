import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import DashboardCharts from "./DashboardCharts";

export default async function DashboardPage() {
  const supabase = await createClient();

  // Fetch dashboard metrics
  const { data: memberStats } = await supabase
    .from("members")
    .select("status");

  const activeMembers = memberStats?.filter(m => m.status === "active").length || 0;
  const onHiatus = memberStats?.filter(m => m.status === "on_hiatus").length || 0;
  const inactive = memberStats?.filter(m => m.status === "inactive").length || 0;
  const totalMembers = activeMembers + onHiatus; // Exclude inactive (cancelled members)

  const now = new Date();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

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
  // Fetch all attendance records (just member_id) with pagination
  let allAttendance: any[] = [];
  let offset = 0;
  const BATCH_SIZE = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data: batch } = await supabase
      .from("attendance")
      .select("member_id")
      .range(offset, offset + BATCH_SIZE - 1);

    if (batch && batch.length > 0) {
      allAttendance = allAttendance.concat(batch);
      offset += batch.length;
      hasMore = batch.length === BATCH_SIZE;
    } else {
      hasMore = false;
    }
  }

  // Count attendance per member
  const attendanceCounts = new Map<string, number>();
  allAttendance.forEach((a) => {
    attendanceCounts.set(a.member_id, (attendanceCounts.get(a.member_id) || 0) + 1);
  });

  // Get top 10 member IDs
  const topMemberIds = Array.from(attendanceCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([memberId]) => memberId);

  // Fetch member details for top 10
  const { data: topMembers } = await supabase
    .from("members")
    .select("id, name, email")
    .in("id", topMemberIds);

  const memberMap = new Map(topMembers?.map(m => [m.id, m]) || []);

  const topAttendeesData = topMemberIds
    .map(memberId => {
      const member = memberMap.get(memberId);
      return member ? {
        id: member.id,
        name: member.name,
        email: member.email,
        count: attendanceCounts.get(memberId) || 0,
      } : null;
    })
    .filter((m): m is { id: string; name: string; email: string; count: number } => m !== null);

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

  // Writing Hours Last 30 Days - median per active member
  const { data: last30DaysAttendance } = await supabase
    .from("attendance")
    .select("join_time, leave_time, member_id")
    .gte("join_time", thirtyDaysAgo.toISOString())
    .lte("join_time", now.toISOString());

  // Calculate hours per member
  const hoursByMember = new Map<string, number>();
  last30DaysAttendance?.forEach(record => {
    const duration = (new Date(record.leave_time).getTime() - new Date(record.join_time).getTime()) / (1000 * 60 * 60);
    hoursByMember.set(record.member_id, (hoursByMember.get(record.member_id) || 0) + duration);
  });

  // Get all active member IDs to include zeros for members who didn't attend
  const { data: activeMemberIds } = await supabase
    .from("members")
    .select("id")
    .eq("status", "active");

  const hoursArray: number[] = [];
  activeMemberIds?.forEach(member => {
    hoursArray.push(hoursByMember.get(member.id) || 0);
  });

  // Calculate median
  const sortedHours = hoursArray.sort((a, b) => a - b);
  const mid = Math.floor(sortedHours.length / 2);
  const medianHours = sortedHours.length > 0
    ? sortedHours.length % 2 === 0
      ? (sortedHours[mid - 1] + sortedHours[mid]) / 2
      : sortedHours[mid]
    : 0;

  // Also calculate average for comparison
  const totalHours = hoursArray.reduce((sum, h) => sum + h, 0);
  const avgHours = hoursArray.length > 0 ? totalHours / hoursArray.length : 0;

  // Weekly Attendance (last 8 weeks)
  const eightWeeksAgo = new Date();
  eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 56); // 8 weeks
  const { data: weeklyAttendanceData } = await supabase
    .from("attendance")
    .select("join_time, member_id")
    .gte("join_time", eightWeeksAgo.toISOString())
    .lte("join_time", now.toISOString());

  // Group by week - track both total attendance and unique members
  const weeklyAttendance = new Map<string, { count: number; uniqueMembers: Set<string> }>();
  weeklyAttendanceData?.forEach((record) => {
    const date = new Date(record.join_time);
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - date.getDay()); // Sunday
    weekStart.setHours(0, 0, 0, 0);
    const weekKey = weekStart.toISOString().split('T')[0];

    const existing = weeklyAttendance.get(weekKey);
    if (existing) {
      existing.count++;
      existing.uniqueMembers.add(record.member_id);
    } else {
      weeklyAttendance.set(weekKey, {
        count: 1,
        uniqueMembers: new Set([record.member_id])
      });
    }
  });

  const weeklyAttendanceArray = Array.from(weeklyAttendance.entries())
    .map(([week, data]) => ({
      week,
      uniqueAttendees: data.uniqueMembers.size,
      repeatAttendance: data.count - data.uniqueMembers.size
    }))
    .sort((a, b) => a.week.localeCompare(b.week));

  // Daily Writing Hours (last 30 days)
  const { data: dailyAttendanceData } = await supabase
    .from("attendance")
    .select("join_time, leave_time")
    .gte("join_time", thirtyDaysAgo.toISOString())
    .lte("join_time", now.toISOString());

  // Group by day
  const dailyHours = new Map<string, number>();
  dailyAttendanceData?.forEach((record) => {
    const date = new Date(record.join_time);
    const dayKey = date.toISOString().split('T')[0];
    const duration = (new Date(record.leave_time).getTime() - new Date(record.join_time).getTime()) / (1000 * 60 * 60);
    dailyHours.set(dayKey, (dailyHours.get(dayKey) || 0) + duration);
  });

  const dailyHoursArray = Array.from(dailyHours.entries())
    .map(([date, hours]) => ({ date, hours: Math.round(hours * 10) / 10 }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Weekly Engagement Rate: % of active members who attended in last 7 days
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(now.getDate() - 7);

  const { data: weeklyAttendees } = await supabase
    .from("attendance")
    .select("member_id")
    .gte("join_time", sevenDaysAgo.toISOString())
    .lte("join_time", now.toISOString());

  const uniqueWeeklyAttendees = new Set(weeklyAttendees?.map(a => a.member_id) || []).size;
  const weeklyEngagementRate = activeMembers > 0
    ? Math.round((uniqueWeeklyAttendees / activeMembers) * 100)
    : 0;

  // Host Participation Rate: % of active members who have hosted (ever)
  const { data: hostsEver } = await supabase
    .from("prickles")
    .select("host")
    .not("host", "is", null);

  const uniqueHosts = new Set(hostsEver?.map(p => p.host) || []).size;
  const hostParticipationRate = activeMembers > 0
    ? Math.round((uniqueHosts / activeMembers) * 100)
    : 0;

  return (
    <div className="container mx-auto px-6 py-8">
        {/* Top Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
          <MetricCard
            label="Total Members"
            value={totalMembers}
            description={`${activeMembers} active, ${onHiatus} on hiatus`}
          />
          <MetricCard
            label="Engagement (7d)"
            value={`${weeklyEngagementRate}%`}
            description={`${uniqueWeeklyAttendees} of ${activeMembers} active members`}
          />
          <MetricCard
            label="Median Hours (30d)"
            value={medianHours.toFixed(1)}
            description={`per member • ${avgHours.toFixed(1)} avg`}
          />
          <MetricCard
            label="Host Participation"
            value={`${hostParticipationRate}%`}
            description={`${uniqueHosts} of ${activeMembers} ever hosted`}
          />
          <MetricCard
            label="At Risk (30d)"
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

        {/* Charts */}
        <DashboardCharts weeklyAttendance={weeklyAttendanceArray} dailyHours={dailyHoursArray} />

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
                    <Link href={`/dashboard/members/${member.id}`} className="hover:opacity-80 transition-opacity">
                      <div className="font-semibold text-slate-900 dark:text-slate-100 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">{member.name}</div>
                      <div className="text-sm text-slate-500 dark:text-slate-400">{member.email}</div>
                    </Link>
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
                    <Link href={`/dashboard/members/${member.id}`} className="hover:opacity-80 transition-opacity">
                      <div className="font-semibold text-slate-900 dark:text-slate-100 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">{member.name}</div>
                      <div className="text-sm text-slate-500 dark:text-slate-400">{member.email}</div>
                    </Link>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

    </div>
  );
}

function MetricCard({ label, value, description, highlighted }: { label: string; value: number | string; description: string; highlighted?: boolean }) {
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
