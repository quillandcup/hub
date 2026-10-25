import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import DashboardCharts from "./DashboardCharts";
import { requireAdminPage } from "@/lib/admin-auth";
import { createRepos } from "@/lib/data/repos";
import { isAtRisk, summarizeAttendance } from "@/lib/attendance-summary";

export const metadata: Metadata = {
  title: "Dashboard",
};

export default async function DashboardPage() {
  await requireAdminPage();
  const supabase = await createClient();

  // Fetch dashboard metrics
  const memberRepo = createRepos(supabase).members;
  const memberStatusCounts = await memberRepo.countsByStatus();

  const activeMembers = memberStatusCounts.get("active") ?? 0;
  const onHiatus = memberStatusCounts.get("on_hiatus") ?? 0;
  const leads = memberStatusCounts.get("lead") ?? 0;
  const cancelled = memberStatusCounts.get("cancelled") ?? 0;
  const totalMembers = activeMembers + onHiatus; // Exclude leads and cancelled (never-converted / former members)

  const now = new Date();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // At-risk: active members with no attendance in last 30 days. Leads,
  // cancelled, and on-hiatus members are excluded — a hiatus member isn't
  // expected to attend, so including them only inflates the count. Staff-only
  // accounts (source='staff', no paying Kajabi subscription) are also
  // excluded — staff who are ALSO paying members keep source='kajabi' and
  // stay eligible.
  const repos = createRepos(supabase);
  const [activeRoster, allAttendance] = await Promise.all([repos.members.list({ status: "active" }), repos.attendance.list()]);
  const summaries = summarizeAttendance(allAttendance);
  const allAtRisk = activeRoster.filter((m) => isAtRisk(m, summaries.get(m.id), thirtyDaysAgo));

  const atRisk = allAtRisk.length;

  // Top 10 most active members (all time)
  // Fetch all attendance records (just member_id) with pagination
  const attendanceRepo = repos.attendance;

  // Count attendance per member
  const attendanceCounts = new Map<string, number>();
  allAttendance.forEach((a) => {
    attendanceCounts.set(a.memberId, (attendanceCounts.get(a.memberId) || 0) + 1);
  });

  // Get top 10 member IDs
  const topMemberIds = Array.from(attendanceCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([memberId]) => memberId);

  // Fetch member details for top 10
  const topMembers = await memberRepo.byIds(topMemberIds);

  const memberMap = new Map(topMembers.map(m => [m.id, m]));

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
  const atRiskMembersList = allAtRisk.slice(0, 10);

  // Writing Hours Last 30 Days - median per active member
  // One read for the longest window below (8 weeks); the 30-day and 7-day figures are slices of it.
  const eightWeeksAgo = new Date();
  eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 56); // 8 weeks
  const recentAttendance = await attendanceRepo.joinedBetween(eightWeeksAgo.toISOString(), now.toISOString());
  const last30DaysAttendance = recentAttendance.filter((a) => new Date(a.joinTime) >= thirtyDaysAgo);

  // Calculate hours per member
  const hoursByMember = new Map<string, number>();
  last30DaysAttendance.forEach(record => {
    const duration = (new Date(record.leaveTime).getTime() - new Date(record.joinTime).getTime()) / (1000 * 60 * 60);
    hoursByMember.set(record.memberId, (hoursByMember.get(record.memberId) || 0) + duration);
  });

  // Get all active member IDs to include zeros for members who didn't attend
  const activeMemberIds = await memberRepo.identities({ status: "active" });

  const hoursArray: number[] = [];
  activeMemberIds.forEach(member => {
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
  // Group by week - track both total attendance and unique members
  const weeklyAttendance = new Map<string, { count: number; uniqueMembers: Set<string> }>();
  recentAttendance.forEach((record) => {
    const date = new Date(record.joinTime);
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - date.getDay()); // Sunday
    weekStart.setHours(0, 0, 0, 0);
    const weekKey = weekStart.toISOString().split('T')[0];

    const existing = weeklyAttendance.get(weekKey);
    if (existing) {
      existing.count++;
      existing.uniqueMembers.add(record.memberId);
    } else {
      weeklyAttendance.set(weekKey, {
        count: 1,
        uniqueMembers: new Set([record.memberId])
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
  const dailyAttendanceData = last30DaysAttendance;

  // Group by day
  const dailyHours = new Map<string, number>();
  dailyAttendanceData.forEach((record) => {
    const date = new Date(record.joinTime);
    const dayKey = date.toISOString().split('T')[0];
    const duration = (new Date(record.leaveTime).getTime() - new Date(record.joinTime).getTime()) / (1000 * 60 * 60);
    dailyHours.set(dayKey, (dailyHours.get(dayKey) || 0) + duration);
  });

  const dailyHoursArray = Array.from(dailyHours.entries())
    .map(([date, hours]) => ({ date, hours: Math.round(hours * 10) / 10 }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Weekly Engagement Rate: % of active members who attended in last 7 days
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(now.getDate() - 7);

  const weeklyAttendees = recentAttendance.filter((a) => new Date(a.joinTime) >= sevenDaysAgo);

  const uniqueWeeklyAttendees = new Set(weeklyAttendees.map((a) => a.memberId)).size;
  const weeklyEngagementRate = activeMembers > 0
    ? Math.round((uniqueWeeklyAttendees / activeMembers) * 100)
    : 0;

  // Host Participation Rate: % of active members who have hosted (ever)
  const uniqueHosts = await repos.prickles.distinctHostCount();
  const hostParticipationRate = activeMembers > 0
    ? Math.round((uniqueHosts / activeMembers) * 100)
    : 0;

  return (
    <div className="container mx-auto px-6 py-8">
        {/* Top Metrics */}
        <div className="@container">
          <div className="grid grid-cols-1 @cards:grid-cols-2 @columns:grid-cols-5 gap-6 mb-8">
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
          <MetricCard
            label="Leads"
            value={leads}
            description="Never converted to paying"
          />
          <MetricCard
            label="Cancelled"
            value={cancelled}
            description="Former paying members"
          />
        </div>
        </div>

        {/* Hedgie Welcome */}
        <div className="bg-gradient-to-r from-plum-50 to-cream dark:from-plum-900/20 dark:to-slate-900 rounded-lg p-6 mb-8 flex items-center gap-6">
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
        <div className="@container">
          <div className="grid grid-cols-1 @cards:grid-cols-2 gap-6 mb-8">
          {/* Top Attendees */}
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
            <h2 className="text-xl font-bold mb-4">🌟 Top Attendees</h2>
            <div className="space-y-3">
              {topAttendeesData.map((member, idx) => (
                <div key={idx} className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800 last:border-0">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-plum-100 dark:bg-plum-900 flex items-center justify-center text-sm font-bold text-plum-600 dark:text-plum-400">
                      {idx + 1}
                    </div>
                    <Link href={`/admin/members/${member.id}`} className="hover:opacity-80 transition-opacity">
                      <div className="font-semibold text-slate-900 dark:text-slate-100 hover:text-plum-600 dark:hover:text-plum-400 transition-colors">{member.name}</div>
                      <div className="text-sm text-slate-600 dark:text-slate-400">{member.email}</div>
                    </Link>
                  </div>
                  <div className="text-lg font-bold text-plum-600 dark:text-plum-400">
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
                <Link href="/admin/at-risk" className="text-sm text-plum-600 dark:text-plum-400 hover:underline">
                  View All ({atRisk})
                </Link>
              )}
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
              Active members with no attendance in last 30 days
            </p>
            <div className="space-y-3">
              {atRiskMembersList.length === 0 ? (
                <div className="text-center py-8 text-slate-600 dark:text-slate-400">
                  No at-risk members! 🎉
                </div>
              ) : (
                atRiskMembersList.map((member: any, idx: number) => (
                  <div key={idx} className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800 last:border-0">
                    <Link href={`/admin/members/${member.id}`} className="hover:opacity-80 transition-opacity">
                      <div className="font-semibold text-slate-900 dark:text-slate-100 hover:text-plum-600 dark:hover:text-plum-400 transition-colors">{member.name}</div>
                      <div className="text-sm text-slate-600 dark:text-slate-400">{member.email}</div>
                    </Link>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
        </div>

    </div>
  );
}

function MetricCard({ label, value, description, highlighted }: { label: string; value: number | string; description: string; highlighted?: boolean }) {
  return (
    <div className={`bg-white dark:bg-slate-900 rounded-lg shadow p-6 ${highlighted ? 'ring-2 ring-red-500' : ''}`}>
      <div className={`text-4xl font-bold mb-2 ${highlighted ? 'text-red-600 dark:text-red-400' : 'text-plum-600 dark:text-plum-400'}`}>
        {value}
      </div>
      <div className="font-semibold text-slate-900 dark:text-slate-100 mb-1">{label}</div>
      <div className="text-sm text-slate-600 dark:text-slate-400">{description}</div>
    </div>
  );
}
