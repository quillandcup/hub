import { createRepos } from "@/lib/data/repos";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requireAdminPage } from "@/lib/admin-auth";
import { fetchActivityFeed, parseFeedFilters, type FeedView } from "@/lib/activity-feed";
import { withReactionEmoji } from "@/lib/slack-reaction-emoji";
import { parsePageParam, parsePageSizeParam } from "@/lib/pagination";
import type { StaffUser } from "@/components/StaffSearch";
import ActivityFilters from "./ActivityFilters";
import ActivityFeedTable from "./ActivityFeedTable";

export const metadata: Metadata = {
  title: "Activity Log",
};

export const maxDuration = 60;


const VIEW_SUMMARIES: Record<FeedView, string> = {
  audit: "Changes made in Hedgie Hub by staff and the system, and anything an admin did while viewing as a member.",
  all: "Everything: changes, member activity (prickles, Slack, outreach, logins) and page visits.",
  privacy: "Changes to who can read message content: Slack channels restricted from staff, and restrictions lifted.",
};

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

// The picker needs every member (paginated by the repository).
async function loadMembers(supabase: SupabaseServer) {
  const members = await createRepos(supabase).members.list({ orderBy: "name" });
  return members.map((m) => ({ id: m.id, name: m.name, displayName: m.displayName, email: m.email, user_id: m.userId }));
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

  const [feed, members, profiles] = await Promise.all([
    fetchActivityFeed(supabase, {
      ...filters,
      page: parsePageParam(params.page),
      pageSize: parsePageSizeParam(params.pageSize),
    }).then(async (page) => ({ ...page, rows: await withReactionEmoji(page.rows) })),
    loadMembers(supabase),
    createRepos(supabase).profiles.staff(),
  ]);

  const nameByUserId = new Map(members.filter((m) => m.user_id).map((m) => [m.user_id!, m.name]));
  const staff: StaffUser[] = profiles.map((p) => ({
    id: p.id,
    name: nameByUserId.get(p.id) ?? p.email,
    email: p.email,
    role: p.role,
  }));

  // The actor filter can also be a non-staff user (clicked from a member's row).
  let actorName: string | null = null;
  if (filters.actorUserId && !staff.some((s) => s.id === filters.actorUserId)) {
    const actor = await createRepos(supabase).profiles.byId(filters.actorUserId);
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
        members={members.map(({ id, name, displayName, email }) => ({ id, name, displayName, email }))}
        actorName={actorName}
        memberName={filters.memberId ? (members.find((m) => m.id === filters.memberId)?.name ?? null) : null}
      />

      {feed.total === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">
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
