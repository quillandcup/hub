import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";
import { matchSlackUsersToMembers } from "@/lib/slack-matching";

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  try {
    // Load reference data
    const [
      { data: slackUsers },
      { data: members },
      { data: aliases },
      { data: ignoredUsers },
    ] = await Promise.all([
      supabase.schema('bronze').from("slack_users").select("user_id, email, real_name, display_name, is_bot"),
      supabase.from("members").select("id, name, email"),
      supabase.from("member_name_aliases").select("alias, member_id, source"),
      supabase.from("ignored_slack_users").select("user_id"),
    ]);

    // Paginate slack_messages to get complete activity counts per user
    const slackMessages: { user_id: string }[] = [];
    {
      let offset = 0;
      let hasMore = true;
      while (hasMore) {
        const { data: batch } = await supabase
          .schema('bronze').from("slack_messages")
          .select("user_id")
          .range(offset, offset + 999);
        if (batch && batch.length > 0) {
          slackMessages.push(...batch);
          offset += batch.length;
          hasMore = batch.length === 1000;
        } else {
          hasMore = false;
        }
      }
    }

    // Match users
    const userToMemberMap = await matchSlackUsersToMembers(
      slackUsers || [],
      members || [],
      aliases || []
    );

    // Filter ignored users
    const ignoredUserIds = new Set((ignoredUsers || []).map(u => u.user_id));

    // Count messages per user
    const messageCountByUser = new Map<string, number>();
    for (const msg of slackMessages || []) {
      messageCountByUser.set(msg.user_id, (messageCountByUser.get(msg.user_id) || 0) + 1);
    }

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
