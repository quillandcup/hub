import { createRepos } from "@/lib/data/repos";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import SlackAliasSearchForm from "./SlackAliasSearchForm";
import { matchSlackUsersToMembers } from "@/lib/slack-matching";
import { requireAdminPage } from "@/lib/admin-auth";

export const metadata: Metadata = {
  title: "Unmatched Slack Users",
};

export default async function UnmatchedSlackUsersPage() {
  await requireAdminPage();
  const supabase = await createClient();

  // Load reference data
  const [
    slackUsers,
    allMembers,
    aliases,
    ignoredUserIds,
  ] = await Promise.all([
    createRepos(supabase).slackUsers.list({ excludeSlackbot: true }),
    createRepos(supabase).members.identities(),
    createRepos(supabase).aliases.nameAliases(),
    createRepos(supabase).slackWorkspace.ignoredUserIds(),
  ]);

  // Complete activity counts per user (the table exceeds 1000 rows; the repository pages through it)
  const messageCountByUser = await createRepos(supabase).slackMessages.messageCountsByUser();

  // Match users
  const userToMemberMap = await matchSlackUsersToMembers(
    slackUsers || [],
    allMembers || [],
    aliases || []
  );


  // Find unmatched users (not matched, not ignored, not bots)
  const unmatchedSlackUsers = (slackUsers || [])
    .filter(u => !userToMemberMap.has(u.user_id))
    .filter(u => !ignoredUserIds.has(u.user_id))
    .filter(u => !u.is_bot)
    .map(u => ({
      slack_user_id: u.user_id,
      email: u.email,
      real_name: u.real_name,
      display_name: u.display_name,
      message_count: messageCountByUser.get(u.user_id) || 0,
      is_deleted: u.is_deleted,
    }))
    .sort((a, b) => {
      // Active Slack accounts first, then by message activity
      if (a.is_deleted !== b.is_deleted) return a.is_deleted ? 1 : -1;
      return b.message_count - a.message_count;
    });

  return (
    <div className="container mx-auto px-6 py-8">
      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Unmatched Slack Users</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
          Create aliases to match Slack users to members using search
        </p>
        <p className="text-xs text-slate-600 dark:text-slate-400 mt-2">
          Showing all unmatched Slack users, sorted by message activity.
        </p>
      </div>

      <SlackAliasSearchForm
        unmatchedSlackUsers={unmatchedSlackUsers}
        allMembers={allMembers || []}
      />
    </div>
  );
}
