import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import MemberFilters from "./MemberFilters";
import MembersTable from "./MembersTable";
import {
  computeMemberEngagementMetrics,
  type EngagementActivityRow,
} from "@/lib/member-engagement";

export const metadata: Metadata = {
  title: "Member Analytics",
};

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

// member_activities (prickle_attended rows) can have 10,000+ rows over time
// (same order of magnitude as prickle_attendance, which it mirrors) —
// paginate. Fetched unfiltered (not `.in("member_id", ...)`) because with
// the "all" members filter the member ID list can grow long enough to
// exceed the Supabase gateway's URL length limit, which fails with a 400.
async function fetchAllPrickleAttended(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<{ member_id: string; occurred_at: string }[]> {
  const BATCH = 1000;
  const rows: { member_id: string; occurred_at: string }[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from("member_activities")
      .select("member_id, occurred_at")
      .eq("activity_type", "prickle_attended")
      .order("occurred_at", { ascending: true })
      .range(offset, offset + BATCH - 1);

    if (error) throw error;
    if (data && data.length > 0) {
      rows.push(...data);
      offset += data.length;
      hasMore = data.length === BATCH;
    } else {
      hasMore = false;
    }
  }

  return rows;
}

// member_activities (all activity types — Slack, prickle attendance,
// outreach touches, logins, ...) feeds the engagement score — only the
// last 30 days are ever used, so scope the query instead of paginating
// full history.
async function fetchRecentActivities(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sinceIso: string
): Promise<EngagementActivityRow[]> {
  const BATCH = 1000;
  const rows: EngagementActivityRow[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from("member_activities")
      .select("member_id, activity_type, engagement_value, occurred_at")
      .gte("occurred_at", sinceIso)
      .order("occurred_at", { ascending: true })
      .range(offset, offset + BATCH - 1);

    if (error) throw error;
    if (data && data.length > 0) {
      rows.push(...data);
      offset += data.length;
      hasMore = data.length === BATCH;
    } else {
      hasMore = false;
    }
  }

  return rows;
}

export default async function MembersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const supabase = await createClient();
  const params = await searchParams;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Get filter from URL
  const filter = (params.filter as string) || "active";
  const search = (params.search as string) || "";

  // Fetch all members matching search (status/engagement filters are applied in
  // memory below) so we can compute a count for every filter tab, not just the
  // currently selected one.
  let query = supabase.from("members").select("*");

  if (search) {
    // Also match members via member_name_aliases (e.g. a Zoom display name
    // that differs from the canonical members.name) so searching by an alias
    // still finds the member. Scoped to source="zoom": "slack" aliases store
    // an opaque Slack user_id, not a name, so it isn't meaningful to text-match.
    const { data: matchingAliases } = await supabase
      .from("member_name_aliases")
      .select("member_id")
      .eq("source", "zoom")
      .ilike("alias", `%${search}%`);
    const aliasMemberIds = Array.from(
      new Set((matchingAliases ?? []).map((a) => a.member_id))
    );

    const orFilters = [`name.ilike.%${search}%`, `email.ilike.%${search}%`];
    if (aliasMemberIds.length > 0) {
      orFilters.push(`id.in.(${aliasMemberIds.join(",")})`);
    }
    query = query.or(orFilters.join(","));
  }

  const { data: allMembers } = await query.order("name");

  // Compute real engagement metrics from member_activities (the mirror of
  // prickle_attendance plus Slack/outreach/login activity) rather than
  // relying on the static member_metrics / member_engagement seed tables.
  const memberIds = (allMembers ?? []).map((m) => m.id);
  const now = new Date();
  const thirtyDaysAgoIso = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [allPrickleAttended, activities] = await Promise.all([
    fetchAllPrickleAttended(supabase),
    fetchRecentActivities(supabase, thirtyDaysAgoIso),
  ]);
  const metricsByMemberId = computeMemberEngagementMetrics(allPrickleAttended, memberIds, now, activities);

  const membersWithMetrics = (allMembers ?? []).map((m) => {
    const metrics = metricsByMemberId.get(m.id) ?? null;
    return {
      ...m,
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
  });

  // At-risk only ever applies to members who are actually still around --
  // "active" or "on_hiatus". A "lead" (never had a real subscription) or a
  // "cancelled" member can have a computed risk_level of "high" (the metrics
  // function doesn't look at status), but that's not a meaningful "at risk"
  // signal for either of those statuses.
  const isAtRisk = (m: (typeof membersWithMetrics)[number]) =>
    m.member_engagement?.risk_level === "high" &&
    (m.status === "active" || m.status === "on_hiatus");

  // Counts per filter tab, scoped to the current search but ignoring the
  // currently selected filter, so each tab shows how many results it would return.
  const filterCounts = {
    all: membersWithMetrics.length,
    active: membersWithMetrics.filter((m) => m.status === "active").length,
    at_risk: membersWithMetrics.filter(isAtRisk).length,
    highly_engaged: membersWithMetrics.filter((m) => m.member_engagement?.engagement_tier === "highly_engaged").length,
    on_hiatus: membersWithMetrics.filter((m) => m.status === "on_hiatus").length,
    lead: membersWithMetrics.filter((m) => m.status === "lead").length,
    cancelled: membersWithMetrics.filter((m) => m.status === "cancelled").length,
    unregistered: membersWithMetrics.filter((m) => m.status === "active" && m.user_id === null).length,
  };

  // Apply the selected filter in memory (status filters use raw columns,
  // engagement filters require the computed metrics above)
  let members: typeof membersWithMetrics | null = membersWithMetrics;
  if (filter === "active") {
    members = membersWithMetrics.filter((m) => m.status === "active");
  } else if (filter === "on_hiatus") {
    members = membersWithMetrics.filter((m) => m.status === "on_hiatus");
  } else if (filter === "lead") {
    members = membersWithMetrics.filter((m) => m.status === "lead");
  } else if (filter === "cancelled") {
    members = membersWithMetrics.filter((m) => m.status === "cancelled");
  } else if (filter === "unregistered") {
    members = membersWithMetrics.filter((m) => m.status === "active" && m.user_id === null);
  } else if (filter === "at_risk") {
    members = membersWithMetrics.filter(isAtRisk);
  } else if (filter === "highly_engaged") {
    members = membersWithMetrics.filter((m) => m.member_engagement?.engagement_tier === "highly_engaged");
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <Link href="/admin" className="text-blue-600 hover:text-blue-700 dark:text-blue-400 text-sm mb-2 inline-block">
            ← Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold">Member Analytics</h1>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow">
          {/* Filters */}
          <div className="p-6 border-b border-slate-200 dark:border-slate-800">
            <MemberFilters currentFilter={filter} counts={filterCounts} />
          </div>

          {/* Result count */}
          <div className="px-6 py-3 text-sm text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
            {(members ?? []).length} {(members ?? []).length === 1 ? "member" : "members"}
            {search && (
              <>
                {" "}matching <span className="font-medium text-slate-700 dark:text-slate-300">&ldquo;{search}&rdquo;</span>
              </>
            )}
          </div>

          {/* Table */}
          <MembersTable members={members ?? []} />

          {members?.length === 0 && (
            <div className="p-12 text-center text-slate-500 dark:text-slate-400">
              No members found
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

