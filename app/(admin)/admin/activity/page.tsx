import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requireAdminPage } from "@/lib/admin-auth";
import { fetchActivityFeed, parseFeedFilters, type FeedView } from "@/lib/activity-feed";
import { parsePageParam, parsePageSizeParam } from "@/lib/pagination";
import type { StaffUser } from "@/components/StaffSearch";
import ActivityFilters from "./ActivityFilters";
import ActivityFeedTable from "./ActivityFeedTable";

export const metadata: Metadata = {
  title: "Activity Log",
};

export const maxDuration = 60;

const BATCH_SIZE = 1000;

const VIEW_SUMMARIES: Record<FeedView, string> = {
  audit: "Changes made in Hedgie Hub by staff and the system, and anything an admin did while viewing as a member.",
  all: "Everything: changes, member activity (prickles, Slack, outreach, logins) and page visits.",
  privacy: "Changes to who can read message content: Slack channels restricted from staff, and restrictions lifted.",
};

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

// The picker needs every member; paginate past PostgREST's 1000-row cap.
async function loadMembers(supabase: SupabaseServer) {
  const members: { id: string; name: string; email: string; user_id: string | null }[] = [];
  for (let offset = 0; ; offset += BATCH_SIZE) {
    const { data, error } = await supabase
      .from("members")
      .select("id, name, email, user_id")
      .order("name")
      .range(offset, offset + BATCH_SIZE - 1);
    if (error) throw error;
    members.push(...(data ?? []));
    if (!data || data.length < BATCH_SIZE) return members;
  }
}

/**
 * The central activity log: ?view=audit|all|privacy, ?kinds=, ?actor=<user id>,
 * ?member=<member id>, ?sudo=1, ?days=, and the standard ?page=&pageSize= of
 * every server-mode table. Reads get_activity_feed()/count_activity_feed().
 */
export default async function ActivityLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminPage();
  const params = await searchParams;
  const filters = parseFeedFilters(params);
  const supabase = await createClient();

  const [feed, members, { data: profiles }] = await Promise.all([
    fetchActivityFeed(supabase, {
      ...filters,
      page: parsePageParam(params.page),
      pageSize: parsePageSizeParam(params.pageSize),
    }),
    loadMembers(supabase),
    supabase.from("user_profiles").select("id, email, role").in("role", ["admin", "assistant"]).order("email"),
  ]);

  const nameByUserId = new Map(members.filter((m) => m.user_id).map((m) => [m.user_id!, m.name]));
  const staff: StaffUser[] = (profiles ?? []).map((p) => ({
    id: p.id,
    name: nameByUserId.get(p.id) ?? p.email,
    email: p.email,
    role: p.role,
  }));

  // The actor filter can also be a non-staff user (clicked from a member's row).
  let actorName: string | null = null;
  if (filters.actorUserId && !staff.some((s) => s.id === filters.actorUserId)) {
    const { data: actor } = await supabase
      .from("user_profiles")
      .select("email")
      .eq("id", filters.actorUserId)
      .maybeSingle();
    actorName = nameByUserId.get(filters.actorUserId) ?? actor?.email ?? "Unknown user";
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-1">Activity Log</h1>
      <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">
        {VIEW_SUMMARIES[filters.view]}
      </p>

      <ActivityFilters
        filters={filters}
        staff={staff}
        members={members.map(({ id, name, email }) => ({ id, name, email }))}
        actorName={actorName}
        memberName={filters.memberId ? (members.find((m) => m.id === filters.memberId)?.name ?? null) : null}
      />

      {feed.total === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Nothing in this window. Try a longer range{filters.view === "audit" ? " or switch to Everything" : ""}.
        </p>
      ) : (
        <ActivityFeedTable
          rows={feed.rows}
          total={feed.total}
          page={feed.page}
          pageSize={feed.pageSize}
          filters={filters}
        />
      )}
    </div>
  );
}
