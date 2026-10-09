import { requireAdmin } from "@/lib/supabase/api-auth";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { NextRequest, NextResponse } from "next/server";
import { matchSlackUsersToMembers } from "@/lib/slack-matching";
import { splitIntoWindows } from "@/lib/processing/date-windows";

// Extend timeout for processing large batches
export const maxDuration = 300; // 5 minutes

// Days of Slack history per project_slack_chat_messages call. A week keeps each call well
// under Postgres's 8s statement timeout (same lesson as the Slack activity rebuild).
const PROJECTION_WINDOW_DAYS = 7;
const BATCH_SIZE = 1000;

/**
 * Process Bronze Slack data into the chat mirror (chat_channels, chat_channel_members,
 * chat_messages, chat_message_contents, chat_reactions). See docs/SLACK_BRIDGED_CHAT.md.
 *
 * 1. Matches Slack users to members in memory (same matching as /api/process/slack)
 * 2. Projects channels and membership (cheap, whole workspace) in one call
 * 3. Projects messages, contents, threads and reactions one week per call
 *
 * Re-runnable: everything is an UPSERT on the Slack keys and Bronze's soft deletes carry
 * over, so chat ids stay stable. Nothing is deleted. Message content is service role only
 * in Bronze, so this runs with the service role after the admin check.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const supabase = createServiceRoleClient();

  try {
    const { fromDate, toDate } = await request.json();
    if (!fromDate || !toDate) {
      return NextResponse.json({ error: "fromDate and toDate are required" }, { status: 400 });
    }

    console.log(`Projecting Slack chat from ${fromDate} to ${toDate}`);

    // STEP 1: Load reference data upfront (members and aliases can exceed 1000 rows)
    const members: { id: string; name: string; email: string }[] = [];
    const aliases: { alias: string; member_id: string; source: "zoom" | "slack" }[] = [];
    for (let offset = 0; ; offset += BATCH_SIZE) {
      const [{ data: m, error: me }, { data: a, error: ae }] = await Promise.all([
        supabase.from("members").select("id, name, email").range(offset, offset + BATCH_SIZE - 1),
        supabase
          .from("member_name_aliases")
          .select("alias, member_id, source")
          .eq("active", true)
          .range(offset, offset + BATCH_SIZE - 1),
      ]);
      if (me) throw me;
      if (ae) throw ae;
      members.push(...(m ?? []));
      aliases.push(...(a ?? []));
      if ((m?.length ?? 0) < BATCH_SIZE && (a?.length ?? 0) < BATCH_SIZE) break;
    }
    const { data: slackUsers, error: usersError } = await supabase
      .schema("bronze")
      .from("slack_users")
      .select("user_id, email, real_name");
    if (usersError) throw usersError;

    // STEP 2: Match Slack users to members (in memory)
    const userMemberMap = Object.fromEntries(
      await matchSlackUsersToMembers(slackUsers ?? [], members, aliases)
    );

    // STEP 3: Channels and membership
    const { data: channelResult, error: channelError } = await supabase.rpc("project_slack_chat_channels", {
      user_member_map: userMemberMap,
    });
    if (channelError) {
      console.error("Error projecting Slack chat channels:", channelError);
      throw channelError;
    }

    // STEP 4: Messages, one week per call. Each call is one transaction, so a failed week
    // changes nothing and the next run redoes it.
    let messages = 0;
    let reactions = 0;
    const windows = splitIntoWindows(new Date(fromDate), new Date(toDate), PROJECTION_WINDOW_DAYS);
    for (const window of windows) {
      const { data: result, error } = await supabase.rpc("project_slack_chat_messages", {
        from_date: window.from.toISOString(),
        to_date: window.to.toISOString(),
        user_member_map: userMemberMap,
      });
      if (error) {
        console.error(
          `Error projecting Slack chat (${window.from.toISOString()} to ${window.to.toISOString()}):`,
          error
        );
        throw error;
      }
      messages += result?.messages ?? 0;
      reactions += result?.reactions ?? 0;
    }

    console.log(
      `Chat projection complete: ${messages} messages, ${reactions} reactions in ${windows.length} weekly windows`
    );

    return NextResponse.json({
      success: true,
      processed: {
        channels: channelResult?.channels ?? 0,
        members: channelResult?.members ?? 0,
        messages,
        reactions,
      },
    });
  } catch (error: any) {
    console.error("Error projecting Slack chat:", error);
    return NextResponse.json({ error: error.message || "Failed to project Slack chat" }, { status: 500 });
  }
}
