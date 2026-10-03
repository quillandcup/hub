import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";
import { matchSlackUsersToMembers } from "@/lib/slack-matching";

// Extend timeout for processing large batches
export const maxDuration = 300; // 5 minutes

/**
 * Process Bronze layer (slack_messages, slack_reactions) into Silver layer (member_activities)
 *
 * This endpoint:
 * 1. Loads reference data upfront (members, aliases, Slack users)
 * 2. Matches Slack users to members in memory
 * 3. Calls reprocess_slack_activities_atomic, which transforms Bronze messages
 *    and reactions in the date range into member_activities, DELETEing the
 *    range's existing Slack activities and INSERTing fresh ones in a single
 *    transaction (reprocessable, and a failure leaves the old rows in place)
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

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

    // STEP 3: Transform + DELETE + INSERT in one transaction. Does nothing when
    // Bronze has no Slack data in the range, so an empty range never wipes
    // existing activities.
    const { data: result, error } = await supabase.rpc("reprocess_slack_activities_atomic", {
      from_date: fromDate,
      to_date: toDate,
      user_member_map: Object.fromEntries(userToMemberMap),
    });

    if (error) {
      console.error("Error reprocessing Slack activities:", error);
      throw error;
    }

    const messages: number = result?.messages ?? 0;
    const reactions: number = result?.reactions ?? 0;

    console.log(`Processing complete: inserted ${messages} message activities, ${reactions} reaction activities`);

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
