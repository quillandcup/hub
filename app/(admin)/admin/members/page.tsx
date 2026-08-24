import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import MemberFilters from "./MemberFilters";
import MembersTable from "./MembersTable";
import {
  computeMemberEngagementMetrics,
  type EngagementAttendanceRow,
} from "@/lib/member-engagement";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

// prickle_attendance can have 10,000+ rows (CLAUDE.md) — paginate.
async function fetchAllAttendance(
  supabase: Awaited<ReturnType<typeof createClient>>,
  memberIds: string[]
): Promise<EngagementAttendanceRow[]> {
  if (memberIds.length === 0) return [];

  const BATCH = 1000;
  const rows: EngagementAttendanceRow[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from("prickle_attendance")
      .select("member_id, prickle_id, join_time")
      .in("member_id", memberIds)
      .order("join_time", { ascending: true })
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

  // Build query - apply filters that work on the members table directly
  let query = supabase.from("members").select("*");

  if (search) {
    query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`);
  }

  // Apply status filters (these work on the members table directly)
  if (filter === "active") {
    query = query.eq("status", "active");
  } else if (filter === "on_hiatus") {
    query = query.eq("status", "on_hiatus");
  } else if (filter === "unregistered") {
    query = query.eq("status", "active").is("user_id", null);
  }

  const { data: allMembers } = await query.order("name");

  // Compute real engagement metrics from prickle_attendance (DISTINCT prickle_id
  // per member, per CLAUDE.md) rather than relying on the static member_metrics /
  // member_engagement seed tables.
  const memberIds = (allMembers ?? []).map((m) => m.id);
  const attendance = await fetchAllAttendance(supabase, memberIds);
  const metricsByMemberId = computeMemberEngagementMetrics(attendance, memberIds);

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

  // Apply engagement filters in memory (these require the computed metrics above)
  let members: typeof membersWithMetrics | null = membersWithMetrics;
  if (filter === "at_risk") {
    members = membersWithMetrics.filter((m) => m.member_engagement?.risk_level === "high");
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
            <MemberFilters currentFilter={filter} />
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

