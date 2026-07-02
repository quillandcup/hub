import { requireAdmin } from "@/lib/supabase/api-auth";
import { matchSlackUsersToMembers } from "@/lib/slack-matching";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/analyze/slack-reconciliation
 * Returns which members are matched in Slack, and which Slack users have no member record.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  try {
    const [
      { data: slackUsers },
      { data: members },
      { data: aliases },
      { data: ignoredUsers },
    ] = await Promise.all([
      supabase.schema("bronze").from("slack_users").select("user_id, email, real_name, display_name, is_bot, is_deleted"),
      supabase.from("members").select("id, name, email, status"),
      supabase.from("member_name_aliases").select("alias, member_id, source"),
      supabase.from("ignored_slack_users").select("user_id"),
    ]);

    const ignoredUserIds = new Set((ignoredUsers || []).map((u) => u.user_id));
    const nonBotSlackUsers = (slackUsers || []).filter(
      (u) => !u.is_bot && !u.is_deleted && !ignoredUserIds.has(u.user_id)
    );

    const userToMemberMap = await matchSlackUsersToMembers(
      nonBotSlackUsers,
      members || [],
      aliases || []
    );

    // Set of member IDs that have a Slack user matched to them
    const membersInSlack = new Set<string>();
    for (const memberId of userToMemberMap.values()) {
      membersInSlack.add(memberId);
    }

    // Slack users not matched to any member record at all (true orphans)
    const orphanSlackUsers = nonBotSlackUsers
      .filter((u) => !userToMemberMap.has(u.user_id))
      .map((u) => ({
        slack_user_id: u.user_id,
        email: u.email,
        real_name: u.real_name,
        display_name: u.display_name,
      }));

    return NextResponse.json({
      total_in_slack: nonBotSlackUsers.length,
      members_in_slack: Array.from(membersInSlack),
      orphan_slack_users: orphanSlackUsers,
    });
  } catch (error: any) {
    console.error("Error analyzing Slack reconciliation:", error);
    return NextResponse.json(
      { error: error.message || "Failed to analyze Slack reconciliation" },
      { status: 500 }
    );
  }
}
