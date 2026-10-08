import { requireAdmin } from "@/lib/supabase/api-auth";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { NextRequest, NextResponse } from "next/server";
import { matchSlackUsersToMembers } from "@/lib/slack-matching";
import { splitIntoWindows } from "@/lib/processing/date-windows";

// Extend timeout for processing large batches
export const maxDuration = 300; // 5 minutes

// Days of Slack activity per reprocess_slack_activities_atomic call.
const REBUILD_WINDOW_DAYS = 7;

/**
 * Process Bronze layer (slack_messages, slack_reactions) into Silver layer (member_activities)
 *
 * This endpoint:
 * 1. Loads reference data upfront (members, aliases, Slack users)
 * 2. Matches Slack users to members in memory
 * 3. Calls reprocess_slack_activities_atomic once per week of the range. Each
 *    call transforms that week's Bronze messages and reactions into
 *    member_activities, DELETEing the week's existing Slack activities and
 *    INSERTing fresh ones in a single transaction (reprocessable, and a
 *    failure leaves that week's old rows in place)
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  // The caller is a verified admin (or the cron). Message content in Bronze is
  // service role only, so this reads and writes with the service role.
  const supabase = createServiceRoleClient();

  try {
    const body = await request.json();
    const { fromDate, toDate } = body;

    if (!fromDate || !toDate) {
      return NextResponse.json(
        { error: "fromDate and toDate are required" },
        { status: 400 }
      );
    }

    console.log(`Processing Slack data from ${fromDate} to ${toDate}`);

    // STEP 1: Load reference data in parallel
    const [
      { data: members },
      { data: aliases },
      { data: slackUsers },
    ] = await Promise.all([
      supabase.from("members").select("id, name, email"),
      supabase.from("member_name_aliases").select("alias, member_id, source").eq("active", true),
      supabase.schema('bronze').from("slack_users").select("user_id, email, real_name"),
    ]);

    // STEP 2: Match Slack users to members (in memory)
    const userToMemberMap = await matchSlackUsersToMembers(
      slackUsers || [],
      members || [],
      aliases || []
    );

    console.log(`Matched ${userToMemberMap.size} Slack users to members`);

    // STEP 3: Does nothing when Bronze has no Slack data in the range, so an
    // empty range never wipes existing activities.
    const [{ data: anyMessage, error: messageCheckError }, { data: anyReaction, error: reactionCheckError }] = await Promise.all([
      supabase.schema("bronze").from("slack_messages").select("message_ts")
        .gte("occurred_at", fromDate).lte("occurred_at", toDate).is("deleted_at", null).limit(1),
      supabase.schema("bronze").from("slack_reactions").select("message_ts")
        .gte("occurred_at", fromDate).lte("occurred_at", toDate).is("deleted_at", null).limit(1),
    ]);
    if (messageCheckError) throw messageCheckError;
    if (reactionCheckError) throw reactionCheckError;

    let messages = 0;
    let reactions = 0;

    if ((anyMessage?.length ?? 0) > 0 || (anyReaction?.length ?? 0) > 0) {
      // STEP 4: Transform + DELETE + INSERT, one week per call. Each call is one
      // transaction, so a failed week keeps its old rows; the weeks before it
      // are already rebuilt and the next run redoes them all. One call for the
      // whole 90-day import (~23k rows) ran past Postgres's 8s statement timeout.
      const userMemberMap = Object.fromEntries(userToMemberMap);
      const windows = splitIntoWindows(new Date(fromDate), new Date(toDate), REBUILD_WINDOW_DAYS);

      for (const window of windows) {
        const { data: result, error } = await supabase.rpc("reprocess_slack_activities_atomic", {
          from_date: window.from.toISOString(),
          to_date: window.to.toISOString(),
          user_member_map: userMemberMap,
          // The empty-range check above covers the whole range, so a week
          // whose messages were all deleted in Slack still loses its activities.
          skip_empty_check: true,
        });

        if (error) {
          console.error(
            `Error reprocessing Slack activities (${window.from.toISOString()} to ${window.to.toISOString()}):`,
            error
          );
          throw error;
        }

        messages += result?.messages ?? 0;
        reactions += result?.reactions ?? 0;
      }

      console.log(
        `Processing complete: inserted ${messages} message activities, ${reactions} reaction activities in ${windows.length} weekly rebuilds`
      );
    } else {
      console.log("No Slack data in Bronze for this range; leaving existing activities alone");
    }

    return NextResponse.json({
      success: true,
      processed: {
        messages,
        reactions,
        total_activities: messages + reactions,
      },
    });
  } catch (error: any) {
    console.error("Error processing Slack data:", error);
    return NextResponse.json(
      { error: error.message || "Failed to process Slack data" },
      { status: 500 }
    );
  }
}
