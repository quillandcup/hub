"use client";

import { useState } from "react";
import MemberAttendanceView from "@/components/MemberAttendanceView";
import { MemberStatusBadge } from "@/components/MemberStatusBadge";
import { parseDateOnly } from "@/lib/member-tenure";
import MemberTimelinePanel from "./MemberTimelinePanel";
import MemberSlackActivityPanel, { computeSlackSummary } from "./MemberSlackActivityPanel";
import MemberBadgesPanel from "./MemberBadgesPanel";
import type { EarnedBadge } from "@/lib/badges";

interface MemberDetailsProps {
  member: any;
  attendanceRecords: any[];
  hiatusHistory: any[];
  slackActivities: any[];
  userTimezonePreference?: string; // User's timezone preference from profile
  membershipHistory: any[];
  earnedBadges: EarnedBadge[];
  awardableBadgeTypes: { id: string; name: string; icon: string }[];
  awards: {
    id: string;
    badgeTypeId: string;
    badgeTypeName: string;
    badgeTypeIcon: string;
    occurredAt: string;
    note: string | null;
  }[];
}

type Tab = "overview" | "attendance" | "slack";

export default function MemberDetails({
  member,
  attendanceRecords,
  hiatusHistory,
  slackActivities,
  userTimezonePreference = "browser",
  membershipHistory,
  earnedBadges,
  awardableBadgeTypes,
  awards,
}: MemberDetailsProps) {
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  const memberMetrics = member.member_metrics || {};
  const memberEngagement = member.member_engagement || {};
  const slackSummary = computeSlackSummary(slackActivities);

  const isRejoin = !!(member.most_recent_joined_at && member.most_recent_joined_at !== member.first_joined_at);
  const mostRecentJoinedDate = member.most_recent_joined_at ? parseDateOnly(member.most_recent_joined_at) : null;
  const daysSinceRejoin = mostRecentJoinedDate
    ? Math.floor((Date.now() - mostRecentJoinedDate.getTime()) / (1000 * 60 * 60 * 24))
    : Infinity;
  const showWelcomeBack = isRejoin && daysSinceRejoin <= 30;

  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "attendance", label: `Attendance History (${attendanceRecords.length})` },
    { id: "slack", label: `Slack Activity (${slackActivities.length})` },
  ];

  return (
    <div className="space-y-6">
      {/* Condensed stat strip */}
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <StatItem label="Status">
            <MemberStatusBadge status={member.status} />
          </StatItem>
          <StatItem label="Engagement">
            <span className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {memberMetrics.engagement_score || 0}
            </span>
            <RiskBadge risk={memberEngagement.risk_level || "low"} />
          </StatItem>
          <StatItem label="Total Prickles">
            <span className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {memberMetrics.total_prickles || 0}
            </span>
          </StatItem>
          <StatItem label="Last Attended">
            <span className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {memberMetrics.last_attended_at
                ? new Date(memberMetrics.last_attended_at).toLocaleDateString()
                : "Never"}
            </span>
          </StatItem>
          <StatItem label="First Joined">
            <span className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {member.first_joined_at
                ? parseDateOnly(member.first_joined_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                : "—"}
            </span>
            {showWelcomeBack && (
              <span className="text-xs text-amber-600 dark:text-amber-400">Welcome back</span>
            )}
          </StatItem>
          <StatItem label="Active Months">
            <span className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {member.total_active_months ?? 0}
            </span>
          </StatItem>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200 dark:border-slate-800">
        <nav className="flex gap-1 -mb-px">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
                  : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 hover:border-slate-300 dark:hover:border-slate-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === "overview" && (
        <div className="space-y-6">
          <MemberTimelinePanel
            memberId={member.id}
            hiatusHistory={hiatusHistory}
            membershipHistory={membershipHistory}
            firstJoinedAt={member.first_joined_at}
          />

          <MemberBadgesPanel
            memberId={member.id}
            earnedBadges={earnedBadges}
            awardableBadgeTypes={awardableBadgeTypes}
            awards={awards}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <SummaryCard
              title="Attendance"
              onViewAll={() => setActiveTab("attendance")}
              viewAllLabel="View attendance history"
            >
              <SummaryStat label="Total Prickles" value={memberMetrics.total_prickles || 0} />
              <SummaryStat label="Last 30 Days" value={memberMetrics.prickles_last_30_days || 0} />
              <SummaryStat
                label="Last Attended"
                value={
                  memberMetrics.last_attended_at
                    ? new Date(memberMetrics.last_attended_at).toLocaleDateString()
                    : "Never"
                }
              />
            </SummaryCard>

            <SummaryCard
              title="Slack Activity"
              onViewAll={() => setActiveTab("slack")}
              viewAllLabel="View Slack activity"
            >
              {slackActivities.length > 0 ? (
                <>
                  <SummaryStat label="Messages" value={slackSummary.totalMessages} />
                  <SummaryStat label="Reactions" value={slackSummary.totalReactions} />
                  <SummaryStat label="Last 30 Days" value={slackSummary.last30Days} />
                  <SummaryStat label="Channels" value={slackSummary.channels} />
                </>
              ) : (
                <p className="text-sm text-slate-500 dark:text-slate-400">No Slack activity yet.</p>
              )}
            </SummaryCard>
          </div>
        </div>
      )}

      {activeTab === "attendance" && (
        <MemberAttendanceView
          member={member}
          attendanceRecords={attendanceRecords}
          userTimezonePreference={userTimezonePreference}
          prickleBasePath="/admin/prickles"
        />
      )}

      {activeTab === "slack" && <MemberSlackActivityPanel slackActivities={slackActivities} />}
    </div>
  );
}

function StatItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</span>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

function SummaryCard({
  title,
  onViewAll,
  viewAllLabel,
  children,
}: {
  title: string;
  onViewAll: () => void;
  viewAllLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold">{title}</h3>
        <button
          onClick={onViewAll}
          className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 hover:underline"
        >
          {viewAllLabel} →
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">{children}</div>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-1 text-xl font-bold text-slate-900 dark:text-slate-100">{value}</div>
    </div>
  );
}

function RiskBadge({ risk }: { risk: string }) {
  const colors = {
    high: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
    medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
    low: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  };

  return (
    <span className={`px-2 py-1 text-xs font-medium rounded-full ${colors[risk as keyof typeof colors] || colors.low}`}>
      {risk}
    </span>
  );
}
