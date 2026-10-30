"use client";

import { useState } from "react";
import { clock } from "@/lib/clock";
import Link from "next/link";
import MemberAttendanceView from "@/components/MemberAttendanceView";
import { MemberStatusBadge, type MemberStatus } from "@/components/MemberStatusBadge";
import { InfoTip } from "@/components/InfoTip";
import { TabBar, replaceTabPath, setTabDocumentTitle, useFollowTabPath } from "@/components/Tabs";
import { MEMBER_TAB_IDS, MEMBER_TAB_LABELS, type MemberTabId } from "./tabs";
import { parseDateOnly } from "@/lib/member-tenure";
import { countDistinctPrickles } from "@/lib/attendance-grouping";
import MemberTimelinePanel from "./MemberTimelinePanel";
import type { SlackSummary } from "@/lib/data/activities";
import MemberSlackActivityPanel from "./MemberSlackActivityPanel";
import ActivityFeedTable from "@/app/(admin)/admin/activity/ActivityFeedTable";
import ActivityFilters from "@/app/(admin)/admin/activity/ActivityFilters";
import { feedSearch, type FeedFilters, type FeedPage } from "@/lib/activity-feed";
import MemberBadgesPanel from "./MemberBadgesPanel";
import MemberIdentityPanel, { type NameAliasRow, type EmailAliasRow } from "./MemberIdentityPanel";
import type { EarnedBadge } from "@/lib/badges";
import { formatDateInZone } from "@/lib/formatters";
import { useTimeZone } from "@/components/Timezone";
import type { AdminMember } from "@/lib/data/members";

/** The member as the page shows them: the admin view plus the engagement numbers computed for this page. */
export type MemberView = AdminMember & {
  metrics: { lastAttendedAt: string | null; pricklesLast30Days: number; totalPrickles: number; engagementScore: number } | null;
  engagement: { riskLevel: string } | null;
};

interface MemberDetailsProps {
  /** The tab the route opened (/admin/members/<id>[/<tab>]). */
  initialTab: MemberTabId;
  member: MemberView;
  attendanceRecords: any[];
  hiatusHistory: any[];
  slackActivities: any[];
  /** Totals over all of the member's Slack activity; slackActivities is only the latest page. */
  slackSummary: SlackSummary;
  /** One page of this member's activity log (lib/activity-feed.ts). */
  /** Null when the feed query failed. */
  activityFeed: FeedPage | null;
  /** The filters that feed was fetched with (parsed from the tab's URL). */
  activityFilters: FeedFilters;
  userTimezonePreference?: string; // User's timezone preference from profile
  membershipHistory: any[];
  programOverrides?: { id: string; starts_at: string; expires_at: string | null; reason: string | null }[];
  statusOverrides?: { id: string; override_type: string; reason: string | null; starts_at: string; expires_at: string | null }[];
  earnedBadges: EarnedBadge[];
  awardableBadgeTypes: { id: string; name: string; icon: string }[];
  awards: {
    id: string;
    badgeTypeId: string;
    badgeTypeName: string;
    badgeTypeIcon: string;
    occurredAt: string;
    note: string | null;
    eventId: string | null;
    eventTitle: string | null;
    eventSlug: string | null;
  }[];
  nameAliases: NameAliasRow[];
  emailAliases: EmailAliasRow[];
}

type Tab = MemberTabId;

export default function MemberDetails({
  initialTab,
  member,
  attendanceRecords,
  hiatusHistory,
  slackActivities,
  slackSummary,
  activityFeed,
  activityFilters,
  userTimezonePreference = "browser",
  membershipHistory,
  programOverrides = [],
  statusOverrides = [],
  earnedBadges,
  awardableBadgeTypes,
  awards,
  nameAliases,
  emailAliases,
}: MemberDetailsProps) {
  const timeZone = useTimeZone();
  const [activeTab, setActiveTabState] = useState<Tab>(initialTab);
  // Keep the tab in the URL path so a reload, or Back from a prickle/detail page, returns to it.
  const basePath = `/admin/members/${member.id}`;
  useFollowTabPath(basePath, MEMBER_TAB_IDS, setActiveTabState);
  const setActiveTab = (tab: Tab) => {
    setActiveTabState(tab);
    if (tab === activeTab) return;
    replaceTabPath(basePath, tab, "overview");
    setTabDocumentTitle({ record: member.displayName?.trim() || member.name }, MEMBER_TAB_LABELS[tab], tab === "overview");
  };

  const status = member.status as MemberStatus; // members.status is checked to these four values
  const memberMetrics = member.metrics;
  const memberEngagement = member.engagement;

  const isRejoin = !!(member.mostRecentJoinedAt && member.mostRecentJoinedAt !== member.firstJoinedAt);
  const mostRecentJoinedDate = member.mostRecentJoinedAt ? parseDateOnly(member.mostRecentJoinedAt) : null;
  const daysSinceRejoin = mostRecentJoinedDate
    ? Math.floor((clock.now() - mostRecentJoinedDate.getTime()) / (1000 * 60 * 60 * 24))
    : Infinity;
  const showWelcomeBack = isRejoin && daysSinceRejoin <= 30;

  const distinctPrickleCount = countDistinctPrickles(attendanceRecords);

  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: MEMBER_TAB_LABELS.overview },
    { id: "attendance", label: `${MEMBER_TAB_LABELS.attendance} (${distinctPrickleCount})` },
    { id: "slack", label: `${MEMBER_TAB_LABELS.slack} (${slackSummary.total})` },
    { id: "activity", label: MEMBER_TAB_LABELS.activity },
    { id: "identity", label: MEMBER_TAB_LABELS.identity },
  ];

  return (
    <div className="space-y-6">
      {/* Condensed stat strip */}
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <StatItem label="Status">
            <div className="flex flex-col gap-0.5">
              <MemberStatusBadge status={status} />
              {statusOverrides.length > 0 && (
                <Link
                  href="/admin/member-overrides"
                  className="text-xs text-plum-600 hover:text-plum-700 dark:text-plum-400 dark:hover:text-plum-300 hover:underline"
                >
                  Status Overrides
                </Link>
              )}
            </div>
          </StatItem>
          <StatItem
            label="Engagement"
            info="Activity points from the last 30 days (a prickle is worth 10, Slack activity 1-3), capped at 100."
          >
            <span className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {memberMetrics?.engagementScore || 0}
              <span className="text-xs font-normal text-slate-600 dark:text-slate-400"> / 100</span>
            </span>
          </StatItem>
          {member.status === "active" && (
            <StatItem
              label="Churn risk"
              info="Days since the member last attended a prickle: low under 15, medium 15-30, high over 30 or never. Separate from the engagement score."
            >
              <RiskBadge risk={memberEngagement?.riskLevel || "low"} />
            </StatItem>
          )}
          <StatItem label="Total Prickles">
            <span className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {memberMetrics?.totalPrickles || 0}
            </span>
          </StatItem>
          <StatItem label="Last Attended">
            <span className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {memberMetrics?.lastAttendedAt
                ? formatDateInZone(memberMetrics?.lastAttendedAt, timeZone)
                : "Never"}
            </span>
          </StatItem>
          <StatItem label="First Joined">
            <span className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {member.firstJoinedAt
                ? parseDateOnly(member.firstJoinedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                : "—"}
            </span>
            {showWelcomeBack && (
              <span className="text-xs text-amber-600 dark:text-amber-400">Welcome back</span>
            )}
          </StatItem>
          <StatItem label="Active Months">
            <span className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {member.totalActiveMonths}
            </span>
          </StatItem>
        </div>
      </div>

      <TabBar tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      {activeTab === "overview" && (
        <div className="space-y-6">
          <div className="@container">
            <div className="grid grid-cols-1 @cards:grid-cols-2 gap-6">
            <SummaryCard
              title="Attendance"
              onViewAll={() => setActiveTab("attendance")}
              viewAllLabel="View attendance history"
            >
              <SummaryStat label="Total Prickles" value={memberMetrics?.totalPrickles || 0} />
              <SummaryStat label="Last 30 Days" value={memberMetrics?.pricklesLast30Days || 0} />
              <SummaryStat
                label="Last Attended"
                value={
                  memberMetrics?.lastAttendedAt
                    ? formatDateInZone(memberMetrics?.lastAttendedAt, timeZone)
                    : "Never"
                }
              />
            </SummaryCard>

            <SummaryCard
              title="Slack Activity"
              onViewAll={() => setActiveTab("slack")}
              viewAllLabel="View Slack activity"
            >
              {slackSummary.total > 0 ? (
                <>
                  <SummaryStat label="Messages" value={slackSummary.messages} />
                  <SummaryStat label="Reactions" value={slackSummary.reactions} />
                  <SummaryStat label="Last 30 Days" value={slackSummary.last30Days} />
                  <SummaryStat label="Channels" value={slackSummary.channels} />
                </>
              ) : (
                <p className="text-sm text-slate-600 dark:text-slate-400">No Slack activity yet.</p>
              )}
            </SummaryCard>
          </div>
          </div>

          <MemberTimelinePanel
            memberId={member.id}
            hiatusHistory={hiatusHistory}
            membershipHistory={membershipHistory}
            programOverrides={programOverrides}
            statusOverrides={statusOverrides}
          />

          <MemberBadgesPanel
            memberId={member.id}
            earnedBadges={earnedBadges}
            awardableBadgeTypes={awardableBadgeTypes}
            awards={awards}
          />
        </div>
      )}

      {activeTab === "identity" && (
        <MemberIdentityPanel
          memberId={member.id}
          name={member.name}
          displayName={member.displayName}
          hasKajabiId={!!member.kajabiId}
          email={member.email}
          emailAliases={emailAliases}
          nameAliases={nameAliases}
        />
      )}

      {activeTab === "attendance" && (
        <MemberAttendanceView
          member={member}
          attendanceRecords={attendanceRecords}
          userTimezonePreference={userTimezonePreference}
          prickleBasePath="/admin/prickles"
        />
      )}

      {activeTab === "activity" &&
        (
          <div>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
              Their own activity, what staff did for or as them, and changes to their record.{" "}
              <Link
                href={`/admin/activity${feedSearch(activityFilters)}`}
                className="text-plum-600 dark:text-plum-400 hover:underline"
              >
                Open in the central log
              </Link>
            </p>
            <ActivityFilters variant="member" filters={activityFilters} basePath={`/admin/members/${member.id}/activity`} />
            {!activityFeed ? (
              <p role="alert" className="text-sm text-red-700 dark:text-red-400">
                The activity log didn&apos;t load. Reload the page to try again; if it keeps failing, the team has been alerted.
              </p>
            ) : activityFeed.total === 0 ? (
              <p className="text-sm text-slate-600 dark:text-slate-400">Nothing in this window. Try a longer range or other filters.</p>
            ) : (
              <ActivityFeedTable {...activityFeed} filters={activityFilters} hideAbout />
            )}
          </div>
        )}
      {activeTab === "slack" && <MemberSlackActivityPanel slackActivities={slackActivities} />}
    </div>
  );
}

function StatItem({ label, info, children }: { label: string; info?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-400">
        {label}
        {info && <InfoTip label={`About ${label}`}>{info}</InfoTip>}
      </span>
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
          className="text-sm text-plum-600 hover:text-plum-700 dark:text-plum-400 dark:hover:text-plum-300 hover:underline"
        >
          {viewAllLabel} →
        </button>
      </div>
      <div className="@container">
        <div className="grid grid-cols-2 @pair:grid-cols-4 gap-4">{children}</div>
      </div>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-xs font-medium text-slate-600 dark:text-slate-400">{label}</div>
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
