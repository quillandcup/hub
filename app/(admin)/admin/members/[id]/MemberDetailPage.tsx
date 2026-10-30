import { parseSlackPageQuery } from "@/lib/slack-activity-table";
import { clock } from "@/lib/clock";
import { createRepos } from "@/lib/data/repos";
import { attendedPrickleRow } from "@/lib/attendance-view";
import { cache } from "react";
import RecordHistoryButton from "@/components/RecordHistoryButton";
import { withMentionNames } from "@/lib/chat/names";
import { withReactionEmoji } from "@/lib/slack-reaction-emoji";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import MemberDetails, { type MemberView } from "./MemberDetails";
import MergeButton from "./MergeButton";
import SplitButton from "./SplitButton";
import { getUserTimezonePreference } from "@/lib/timezone";
import { startSudo } from "@/app/actions/sudo";
import { fetchMembershipHistory } from "@/lib/kajabi/membership-history";
import {
  computeMemberEngagementMetrics,
  type EngagementActivityRow,
} from "@/lib/member-engagement";
import { getMemberBadges } from "@/lib/badges";
import { MEMBER_TAB_LABELS, type MemberTabId } from "./tabs";
import { getMemberDisplayName } from "@/lib/member-display-name";
import { tabTitle } from "@/lib/tab-routes";
import { loadPushDevices } from "@/lib/channels/web-push";
import { describeDevice } from "@/lib/device-label";
import { createServiceRoleClient } from "@/lib/supabase/service";
import * as Sentry from "@sentry/nextjs";
import { fetchActivityFeed, parseFeedFilters, MEMBER_DEFAULTS, type FeedPage, type ActivityFeedRow } from "@/lib/activity-feed";
import { traced } from "@/lib/query-trace";
import { parsePageParam, parsePageSizeParam } from "@/lib/pagination";


const getMemberRow = cache(async (id: string) => {
  const supabase = await createClient();
  return createRepos(supabase).members.adminView(id);
});

/** generateMetadata for the member page (Overview) or one of its tab routes: the member's name, then the tab. */
export function memberTabMetadata(tab: MemberTabId) {
  return async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
    const { id } = await params;
    const member = await getMemberRow(id);
    return { title: tabTitle({ record: member ? getMemberDisplayName({ name: member.name, display_name: member.displayName }) : "Member" }, MEMBER_TAB_LABELS[tab], tab === "overview") };
  };
}

/**
 * Admin member detail, rendered by /admin/members/<id> (Overview) and each
 * /admin/members/<id>/<tab> route with that tab open. Every tab's data loads here, so switching
 * tabs is instant. Callers have already run requireAdminPage().
 */
export default async function MemberDetailPage({
  id,
  tab,
  searchParams = {},
}: {
  id: string;
  tab: MemberTabId;
  /** The tab's own query: the Activity Log's ?page=&pageSize=, the Slack tab's ?type=&channel=&sort=&page=. */
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const supabase = await createClient();

  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  // Fetch member data
  const memberRow = await getMemberRow(id);

  if (!memberRow) {
    notFound();
  }

  // Devices this member gets Browser notifications on (the table holds push credentials, so service
  // role, after the admin check the callers ran). Only the labels leave this function.
  const pushDeviceLabels = await loadPushDevices(createServiceRoleClient(), id)
    .then((devices) => devices.map((d) => describeDevice(d.userAgent)))
    .catch(() => []);

  // Fetch all attendance records for this member with prickle details
  const attendance = (await traced("member page: attendance", () => createRepos(supabase).attendance.forMemberWithPrickles(id), { memberId: id })).map(attendedPrickleRow);

  // Compute real engagement metrics from member_activities — the mirror of
  // this member's prickle attendance (unbounded, for lastAttendedAt/
  // totalPrickles) plus all activity types in the last 30 days (for the
  // score) — rather than the static member_metrics / member_engagement seed
  // tables. `attendance` above stays the rich, unfiltered source for the
  // attendanceRecords panel below.
  const now = new Date();
  const thirtyDaysAgoIso = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [allPrickleAttended, recentActivities] = await traced(
    "member page: engagement activities",
    () =>
      Promise.all([
        createRepos(supabase).activities.prickleAttendances(id),
        createRepos(supabase).activities.engagementSince(id, thirtyDaysAgoIso),
      ]),
    { memberId: id }
  );
  const activitiesForMetrics: EngagementActivityRow[] = recentActivities;

  const metrics = computeMemberEngagementMetrics(allPrickleAttended, [id], now, activitiesForMetrics).get(id) ?? null;
  const member: MemberView = {
    ...memberRow,
    metrics: metrics
      ? {
          lastAttendedAt: metrics.lastAttendedAt,
          pricklesLast30Days: metrics.pricklesLast30Days,
          totalPrickles: metrics.totalPrickles,
          engagementScore: metrics.engagementScore,
        }
      : null,
    engagement: metrics ? { riskLevel: metrics.riskLevel } : null,
  };

  // Fetch member name aliases
  const [allNames, aliasEmails] = await Promise.all([createRepos(supabase).aliases.namesOf(id), createRepos(supabase).aliases.emailsOf(id)]);
  // The header chips only need the alias text, by name.
  const aliases = allNames.map((a) => ({ alias: a.alias })).sort((a, b) => (a.alias < b.alias ? -1 : a.alias > b.alias ? 1 : 0));
  // The Identity panel (pen name selection) needs the full rows, newest first.
  const nameAliasRows = allNames.map(({ id, alias, source, active }) => ({ id, alias, source, active }));
  const emailAliases = aliasEmails
    .map(({ id, alias_email, source, active }) => ({ id, alias_email, source, active }))
    .sort((a, b) => (a.alias_email < b.alias_email ? -1 : a.alias_email > b.alias_email ? 1 : 0));

  // Fetch hiatus history — member_hiatus_history is the live source of
  // truth for hiatus tracking.
  const { data: hiatusRows } = await supabase
    .from("member_hiatus_history")
    .select("id, start_date, end_date, reason, notes")
    .eq("member_id", id)
    .order("start_date", { ascending: false });
  const hiatusHistory = hiatusRows || [];

  // Fetch program-cohort enrollments (180 Program, Self-Editing Academy, ...)
  // — a program-only member (no real Kajabi subscription, see
  // supabase/migrations/20260903000000_create_program_cohort_tracking.sql)
  // has empty membershipHistory/hiatusHistory, so without this the timeline
  // below shows nothing at all for them.
  const programOverrides = (await createRepos(supabase).programs.enrollmentsOf(id)).map((e) => ({
    id: e.id,
    starts_at: e.startsAt,
    expires_at: e.expiresAt,
    reason: e.programName,
  }));

  // Fetch status overrides (gift/direct_stripe/special — see
  // reprocess_members_atomic Step 4) — these force status='active' but,
  // unlike a real Kajabi stint, produce no membership-history row of their
  // own, so without this the timeline shows a gap during an active gifted
  // membership (e.g. a lifetime membership granted in exchange for an
  // acquisition).
  const { data: statusOverrideRows } = await supabase
    .from("member_status_overrides")
    .select("id, override_type, reason, starts_at, expires_at")
    .eq("member_id", id)
    .order("starts_at", { ascending: false });
  const statusOverrides = statusOverrideRows || [];

  // Fetch Kajabi membership history — query all customer IDs across primary + alias emails
  const allEmails = [member.email, ...(emailAliases || []).map((a: any) => a.alias_email)];
  const kajabiCustomers = await createRepos(supabase).billing.kajabiCustomersByEmail(allEmails);

  const customerIds = kajabiCustomers.map((c) => c.kajabi_customer_id).filter(Boolean);
  const membershipHistory = await traced("member page: membership history", () => fetchMembershipHistory(supabase, customerIds), { memberId: id });

  // The Slack tab pages on the server (?type=&channel=&sort=&dir=&page=&pageSize=); the other tabs
  // only need the totals for the tab count and the overview tiles.
  const thirtyDaysAgo = new Date(clock.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const activities = createRepos(supabase).activities;
  const slackQuery = parseSlackPageQuery(searchParams);
  const [slackSummary, slackPage, slackChannels] = await Promise.all([
    traced("member page: slack summary", () => activities.slackSummary(id, thirtyDaysAgo), { memberId: id }),
    tab === "slack"
      ? traced("member page: slack page", () => activities.slackPage(id, slackQuery), { memberId: id })
      : Promise.resolve({ rows: [], total: 0, page: 1 }),
    tab === "slack" ? traced("member page: slack channels", () => activities.slackChannels(id), { memberId: id }) : Promise.resolve([]),
  ]);

  // The Activity Log tab: the same feed as /admin/activity narrowed to this member (their own
  // activity, what staff did for or as them, changes to their record), Everything by default.
  // Its filters are the URL's ?view=&days=&nosystem=&noslack=&kinds=&sudo=.
  const activityFilters = { ...parseFeedFilters(searchParams, MEMBER_DEFAULTS), memberId: id };
  // A failing feed (traced has already alerted and tagged the section) shows as a message on the
  // Activity Log tab instead of taking the whole member page down.
  let activityFeed: (FeedPage & { rows: ActivityFeedRow[] }) | null = null;
  try {
    const feedPage = await traced(
      "member page: activity feed",
      () =>
        fetchActivityFeed(supabase, {
          ...activityFilters,
          page: parsePageParam(searchParams.page),
          pageSize: parsePageSizeParam(searchParams.pageSize),
        }),
      { memberId: id, days: String(activityFilters.days), view: activityFilters.view }
    );
    activityFeed = { ...feedPage, rows: await withReactionEmoji(feedPage.rows) };
  } catch (error) {
    Sentry.captureException(error);
  }

  // Get user's timezone preference
  const userTimezone = await getUserTimezonePreference();

  const badges = createRepos(supabase).badges;
  const [earnedBadges, awardableBadgeTypes, rawAwards] = await Promise.all([
    getMemberBadges(supabase, id, metrics?.totalPrickles ?? 0, memberRow.firstJoinedAt),
    badges.manualTypes(),
    badges.awardsWithDetails(id),
  ]);

  const awards = rawAwards.map((a) => ({
    id: a.id,
    badgeTypeId: a.badgeTypeId,
    badgeTypeName: a.badgeTypeName ?? "Badge",
    badgeTypeIcon: a.badgeTypeIcon ?? "🏅",
    occurredAt: a.occurredAt,
    note: a.note,
    eventId: a.eventId,
    eventTitle: a.eventTitle,
    eventSlug: a.eventSlug,
  }));

  return (
    <div className="min-h-screen bg-canvas dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4 relative">
          <Link href="/admin/members" className="text-plum-600 hover:text-plum-700 dark:text-plum-400 text-sm mb-2 inline-block">
            ← Back to Members
          </Link>
          <div className="mt-2">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold">{getMemberDisplayName({ name: member.name, display_name: member.displayName })}</h1>
              {getMemberDisplayName({ name: member.name, display_name: member.displayName }) !== member.name && (
                <span className="text-sm text-slate-500 dark:text-slate-400">{member.name}</span>
              )}
              {aliases && aliases.length > 0 && (
                <div className="flex items-center gap-2">
                  <div className="flex flex-wrap gap-1.5">
                    {aliases.map(({ alias }) => (
                      <span
                        key={alias}
                        className="px-2 py-0.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded text-xs border border-slate-200 dark:border-slate-600"
                      >
                        {alias}
                      </span>
                    ))}
                  </div>
                  <div className="group relative inline-block">
                    <svg
                      className="w-4 h-4 text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 cursor-help"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                    <div className="opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto absolute left-0 top-6 w-64 p-3 bg-slate-900 dark:bg-slate-700 text-white text-xs rounded shadow-lg z-10 transition-opacity duration-200 before:content-[''] before:absolute before:left-0 before:bottom-full before:w-full before:h-6">
                      Aliases help match Zoom names to people. <Link href="/admin/data/aliases" className="underline hover:text-plum-300">Manage aliases →</Link>
                    </div>
                  </div>
                </div>
              )}
              <form action={startSudo.bind(null, member.id, undefined)}>
                <button
                  type="submit"
                  className="px-3 py-1 text-xs font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-700 rounded-md hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors"
                >
                  Sudo As
                </button>
              </form>
              <MergeButton member={{ id: member.id, name: member.name, email: member.email }} />
              <SplitButton
                member={{ id: member.id, name: member.name, email: member.email }}
                nameAliases={nameAliasRows ?? []}
                emailAliases={emailAliases ?? []}
              />
            </div>
            <div className="mt-1 flex flex-col gap-1">
              {(member.kajabiId || member.stripeCustomerId) && (
                <div className="flex items-center gap-3 text-xs">
                  {member.kajabiId && (
                    <a
                      href={`https://app.kajabi.com/admin/contacts/${member.kajabiId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-plum-600 hover:text-plum-700 dark:text-plum-400 dark:hover:text-plum-300 hover:underline"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                      Kajabi
                    </a>
                  )}
                  {member.kajabiId && member.stripeCustomerId && (
                    <span className="text-slate-300 dark:text-slate-600">|</span>
                  )}
                  {member.stripeCustomerId && (
                    <a
                      href={`https://dashboard.stripe.com/customers/${member.stripeCustomerId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-plum-600 hover:text-plum-700 dark:text-plum-400 dark:hover:text-plum-300 hover:underline"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                      Stripe
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="absolute top-4 right-6">
            <RecordHistoryButton entityType="member" entityId={member.id} includeMemberRows label={getMemberDisplayName({ name: member.name, display_name: member.displayName })} />
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8 space-y-6">
        {pushDeviceLabels.length > 0 && (
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Browser notifications on {pushDeviceLabels.length} {pushDeviceLabels.length === 1 ? "device" : "devices"}:{" "}
            {pushDeviceLabels.join(", ")}
          </p>
        )}
        <MemberDetails
          key={tab}
          initialTab={tab}
          member={member}
          attendanceRecords={attendance}
          hiatusHistory={hiatusHistory || []}
          activityFeed={activityFeed}
          activityFilters={activityFilters}
          slackSummary={slackSummary}
          slackPage={{
            rows: await withReactionEmoji(await withMentionNames(slackPage.rows)),
            total: slackPage.total,
            page: slackPage.page,
            pageSize: slackQuery.pageSize,
            kind: slackQuery.kind,
            channel: slackQuery.channel,
            channels: slackChannels,
          }}
          userTimezonePreference={userTimezone}
          membershipHistory={membershipHistory}
          programOverrides={programOverrides}
          statusOverrides={statusOverrides}
          earnedBadges={earnedBadges}
          awardableBadgeTypes={awardableBadgeTypes}
          awards={awards}
          nameAliases={nameAliasRows ?? []}
          emailAliases={emailAliases ?? []}
        />
      </main>
    </div>
  );
}
