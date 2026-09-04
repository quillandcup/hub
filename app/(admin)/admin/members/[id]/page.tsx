import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import MemberDetails from "./MemberDetails";
import MergeButton from "./MergeButton";
import { getUserTimezonePreference } from "@/lib/timezone";
import { startSudo } from "@/app/actions/sudo";
import { fetchMembershipHistory } from "@/lib/kajabi/membership-history";
import {
  computeMemberEngagementMetrics,
  type EngagementAttendanceRow,
  type EngagementActivityRow,
} from "@/lib/member-engagement";
import { getMemberBadges } from "@/lib/badges";

const getMemberRow = cache(async (id: string) => {
  const supabase = await createClient();
  const { data } = await supabase.from("members").select("*").eq("id", id).single();
  return data;
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const member = await getMemberRow(id);
  return { title: member?.name ?? "Member" };
}

export default async function MemberDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const supabase = await createClient();
  const { id } = await params;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Fetch member data
  const memberRow = await getMemberRow(id);

  if (!memberRow) {
    notFound();
  }

  // Fetch all attendance records for this member with prickle details
  const { data: attendance } = await supabase
    .from("prickle_attendance")
    .select(`
      id,
      join_time,
      leave_time,
      confidence_score,
      prickles(
        id,
        host:members(id, name),
        start_time,
        end_time,
        prickle_types(name)
      )
    `)
    .eq("member_id", id)
    .order("join_time", { ascending: false });

  // Compute real engagement metrics from this member's attendance (DISTINCT
  // prickle_id per CLAUDE.md) rather than the static member_metrics /
  // member_engagement seed tables.
  const attendanceForMetrics: EngagementAttendanceRow[] = (attendance ?? []).map((a: any) => {
    const prickle = Array.isArray(a.prickles) ? a.prickles[0] : a.prickles;
    return {
      member_id: id,
      prickle_id: prickle?.id ?? a.id,
      join_time: a.join_time,
    };
  });
  // Slack (and future) activity feeds the engagement score's activity
  // component — only the last 30 days are ever used, so scope the query.
  const now = new Date();
  const thirtyDaysAgoIso = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: recentActivities } = await supabase
    .from("member_activities")
    .select("member_id, engagement_value, occurred_at")
    .eq("member_id", id)
    .gte("occurred_at", thirtyDaysAgoIso);
  const activitiesForMetrics: EngagementActivityRow[] = recentActivities ?? [];

  const metrics =
    computeMemberEngagementMetrics(attendanceForMetrics, [id], now, activitiesForMetrics).get(id) ?? null;
  const member = {
    ...memberRow,
    member_metrics: metrics
      ? {
          last_attended_at: metrics.lastAttendedAt,
          prickles_last_30_days: metrics.pricklesLast30Days,
          total_prickles: metrics.totalPrickles,
          engagement_score: metrics.engagementScore,
        }
      : null,
    member_engagement: metrics
      ? {
          risk_level: metrics.riskLevel,
          engagement_tier: metrics.engagementTier,
        }
      : null,
  };

  // Fetch member name aliases
  const { data: aliases } = await supabase
    .from("member_name_aliases")
    .select("alias")
    .eq("member_id", id)
    .order("alias");

  // Fetch email aliases
  const { data: emailAliases } = await supabase
    .from("member_email_aliases")
    .select("alias_email")
    .eq("canonical_email", member.email)
    .order("alias_email");

  // Fetch hiatus history — member_hiatus_history is the live source of
  // truth for hiatus tracking.
  const { data: hiatusRows } = await supabase
    .from("member_hiatus_history")
    .select("id, start_date, end_date, reason, notes")
    .eq("member_id", id)
    .order("start_date", { ascending: false });
  const hiatusHistory = hiatusRows || [];

  // Fetch 180 Program overrides — a 180-Program-only member (no real Kajabi
  // subscription, see supabase/migrations/20260902200000_add_180_program_override_type.sql)
  // has empty membershipHistory/hiatusHistory, so without this the timeline
  // below shows nothing at all for them.
  const { data: programOverrideRows } = await supabase
    .from("member_status_overrides")
    .select("id, starts_at, expires_at, reason")
    .eq("member_id", id)
    .eq("override_type", "180_program")
    .order("starts_at", { ascending: false });
  const programOverrides = programOverrideRows || [];

  // Fetch Kajabi membership history — query all customer IDs across primary + alias emails
  const allEmails = [member.email, ...(emailAliases || []).map((a: any) => a.alias_email)];
  const { data: kajabiCustomers } = await supabase
    .schema("bronze")
    .from("kajabi_customers")
    .select("kajabi_customer_id")
    .in("email", allEmails);

  const customerIds = (kajabiCustomers || []).map((c: any) => c.kajabi_customer_id).filter(Boolean);
  const membershipHistory = await fetchMembershipHistory(supabase, customerIds);

  // Fetch Slack activities
  const { data: slackActivities } = await supabase
    .from("member_activities")
    .select("*")
    .eq("member_id", id)
    .eq("source", "slack")
    .order("occurred_at", { ascending: false })
    .limit(50);

  // Get user's timezone preference
  const userTimezone = await getUserTimezonePreference();

  const [earnedBadges, { data: awardableBadgeTypes }, { data: rawAwards }] = await Promise.all([
    getMemberBadges(supabase, id, metrics?.totalPrickles ?? 0, memberRow.first_joined_at),
    supabase.from("badge_types").select("id, name, icon").eq("is_automatic", false).order("name"),
    supabase
      .from("member_badges")
      .select("id, badge_type_id, occurred_at, note, badge_types(name, icon)")
      .eq("member_id", id)
      .order("occurred_at", { ascending: false }),
  ]);

  const awards = (rawAwards ?? []).map((row: any) => ({
    id: row.id,
    badgeTypeId: row.badge_type_id,
    badgeTypeName: row.badge_types?.name ?? "Badge",
    badgeTypeIcon: row.badge_types?.icon ?? "🏅",
    occurredAt: row.occurred_at,
    note: row.note,
  }));

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <Link href="/admin/members" className="text-blue-600 hover:text-blue-700 dark:text-blue-400 text-sm mb-2 inline-block">
            ← Back to Members
          </Link>
          <div className="mt-2">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold">{member.name}</h1>
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
                      className="w-4 h-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 cursor-help"
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
                      Aliases help match Zoom names to people. <Link href="/admin/data/aliases" className="underline hover:text-blue-300">Manage aliases →</Link>
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
              <Link
                href="/admin/member-overrides"
                className="px-3 py-1 text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
              >
                Status Overrides
              </Link>
            </div>
            <div className="mt-1 flex flex-col gap-1">
              <p className="text-sm text-slate-600 dark:text-slate-400">
                {member.email}
              </p>
              {emailAliases && emailAliases.length > 0 && (
                <p className="text-xs text-slate-400 dark:text-slate-500 italic">
                  Also known as: {emailAliases.map(({ alias_email }) => alias_email).join(", ")}
                </p>
              )}
              {(member.kajabi_id || member.stripe_customer_id) && (
                <div className="flex items-center gap-3 text-xs">
                  {member.kajabi_id && (
                    <a
                      href={`https://app.kajabi.com/admin/contacts/${member.kajabi_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 hover:underline"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                      Kajabi
                    </a>
                  )}
                  {member.kajabi_id && member.stripe_customer_id && (
                    <span className="text-slate-300 dark:text-slate-600">|</span>
                  )}
                  {member.stripe_customer_id && (
                    <a
                      href={`https://dashboard.stripe.com/customers/${member.stripe_customer_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 hover:underline"
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
        </div>
      </header>

      <main className="container mx-auto px-6 py-8 space-y-6">
        <MemberDetails
          member={member}
          attendanceRecords={attendance || []}
          hiatusHistory={hiatusHistory || []}
          slackActivities={slackActivities || []}
          userTimezonePreference={userTimezone}
          membershipHistory={membershipHistory}
          programOverrides={programOverrides}
          earnedBadges={earnedBadges}
          awardableBadgeTypes={awardableBadgeTypes ?? []}
          awards={awards}
        />
      </main>
    </div>
  );
}
