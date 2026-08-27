import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import SlackAliasSearchForm from "./SlackAliasSearchForm";
import { matchSlackUsersToMembers } from "@/lib/slack-matching";

export const metadata: Metadata = {
  title: "Unmatched Slack Users",
};

export default async function UnmatchedSlackUsersPage() {
  const supabase = await createClient();

  // Load reference data
  const [
    { data: slackUsers },
    { data: allMembers },
    { data: aliases },
    { data: ignoredUsers },
  ] = await Promise.all([
    supabase.schema('bronze').from("slack_users").select("user_id, email, real_name, display_name, is_bot"),
    supabase.from("members").select("id, name, email").order("name"),
    supabase.from("member_name_aliases").select("alias, member_id, source"),
    supabase.from("ignored_slack_users").select("user_id"),
  ]);

  // Paginate slack_messages to get complete activity counts per user — table exceeds 1000 rows
  const slackMessages: { user_id: string }[] = [];
  {
    const BATCH = 1000;
    let offset = 0, hasMore = true;
    while (hasMore) {
      const { data: batch } = await supabase
        .schema('bronze').from("slack_messages")
        .select("user_id")
        .range(offset, offset + BATCH - 1);
      if (batch && batch.length > 0) {
        slackMessages.push(...batch);
        offset += batch.length;
        hasMore = batch.length === BATCH;
      } else {
        hasMore = false;
      }
    }
  }

  // Match users
  const userToMemberMap = await matchSlackUsersToMembers(
    slackUsers || [],
    allMembers || [],
    aliases || []
  );

  // Filter ignored users
  const ignoredUserIds = new Set((ignoredUsers || []).map(u => u.user_id));

  // Count messages per user
  const messageCountByUser = new Map<string, number>();
  for (const msg of slackMessages) {
    messageCountByUser.set(msg.user_id, (messageCountByUser.get(msg.user_id) || 0) + 1);
  }

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
    }))
    .sort((a, b) => b.message_count - a.message_count); // Sort by activity

  return (
    <div className="container mx-auto px-6 py-8">
      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Unmatched Slack Users</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
          Create aliases to match Slack users to members using search
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-500 mt-2">
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
