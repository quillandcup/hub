import { createRepos } from "@/lib/data/repos";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { NextRequest, NextResponse } from "next/server";
import { loadVerifiedSlackLinks, matchSlackUsersToMembers } from "@/lib/slack-matching";

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  try {
    // Load reference data
    const [
      slackUsers,
      members,
      aliases,
      ignoredUserIds,
    ] = await Promise.all([
      createRepos(supabase).slackUsers.list({ excludeSlackbot: true }),
      createRepos(supabase).members.identities(),
      createRepos(supabase).aliases.nameAliases(),
      createRepos(supabase).slackWorkspace.ignoredUserIds(),
    ]);

    // Complete activity counts per user (the repository pages through the table)
    const messageCountByUser = await createRepos(supabase).slackMessages.messageCountsByUser();

    // Match users
    const userToMemberMap = await matchSlackUsersToMembers(
      slackUsers || [],
      members,
      aliases || [],
      await loadVerifiedSlackLinks(createRepos(createServiceRoleClient()))
    );


    // Find unmatched users (not matched, not ignored, not bots)
    const unmatched = (slackUsers || [])
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

    return NextResponse.json({
      unmatched,
      total_slack_users: slackUsers?.length || 0,
      matched: userToMemberMap.size,
      ignored: ignoredUserIds.size,
    });
  } catch (error: any) {
    console.error("Error fetching unmatched Slack users:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch unmatched users" },
      { status: 500 }
    );
  }
}
