import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { matchSlackUsersToMembers } from "@/lib/slack-matching";

// Extend timeout for processing large batches
export const maxDuration = 300; // 5 minutes

// Helper to chunk array for batch processing
function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Process Bronze layer (slack_messages, slack_reactions) into Silver layer (member_activities)
 *
 * This endpoint:
 * 1. Loads all reference data upfront (members, aliases)
 * 2. Loads Slack Bronze data in date range
 * 3. Matches Slack users to members
 * 4. Transforms to member_activities
 * 5. DELETEs existing Slack activities in range
 * 6. INSERTs fresh activities (reprocessable)
 */
export async function POST(request: NextRequest) {
  // Check authentication
  const authHeader = request.headers.get('authorization');
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const isServiceRole = authHeader && serviceRoleKey && authHeader.includes(serviceRoleKey);

  let supabase;

  if (isServiceRole) {
    // Use service role client for tests
    const { createClient: createSupabaseClient } = await import('@supabase/supabase-js');
    supabase = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
  } else {
    // Use cookie-based client for normal requests
    supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

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
    ] = await Promise.all([
      supabase.from("members").select("id, name, email"),
      supabase.from("member_name_aliases").select("alias, member_id, source"),
    ]);

    // STEP 2: Load Bronze Slack data in date range (with pagination)
    const slackMessages = await loadAllMessages(supabase, fromDate, toDate);
    const slackReactions = await loadAllReactions(supabase, fromDate, toDate);

    console.log(`Loaded ${slackMessages.length} messages, ${slackReactions.length} reactions`);

    if (slackMessages.length === 0 && slackReactions.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No Slack data found in date range",
        processed: { messages: 0, reactions: 0 },
      });
    }

    // STEP 3: Load Slack users for matching
    const { data: slackUsers } = await supabase
      .from("slack_users")
      .select("user_id, email, real_name");

    // Match Slack users to members (in memory)
    const userToMemberMap = await matchSlackUsersToMembers(
      slackUsers || [],
      members || [],
      aliases || []
    );

    console.log(`Matched ${userToMemberMap.size} Slack users to members`);

    // STEP 4: Transform messages → member_activities
    const messageActivities = slackMessages
      .map(msg => {
        const memberId = userToMemberMap.get(msg.user_id);
        if (!memberId) return null; // Skip non-members

        const isThreadReply = msg.thread_ts && msg.thread_ts !== msg.message_ts;

        return {
          member_id: memberId,
          activity_type: isThreadReply ? 'slack_thread_reply' : 'slack_message',
          activity_category: 'communication',
          title: `Posted in #${msg.channel_name}`,
          description: msg.text?.substring(0, 200) || null,
          metadata: {
            channel_id: msg.channel_id,
            channel_name: msg.channel_name,
            channel_type: msg.channel_type,
            message_ts: msg.message_ts,
            thread_ts: msg.thread_ts,
            is_thread_reply: isThreadReply,
            has_files: msg.files ? true : false,
          },
          related_id: `${msg.channel_id}:${msg.message_ts}`,
          engagement_value: calculateMessageValue(msg),
          occurred_at: msg.occurred_at,
          source: 'slack',
        };
      })
      .filter(a => a !== null);

    // STEP 5: Transform reactions → member_activities
    const reactionActivities = slackReactions
      .map(reaction => {
        const memberId = userToMemberMap.get(reaction.user_id);
        if (!memberId) return null;

        return {
          member_id: memberId,
          activity_type: 'slack_reaction',
          activity_category: 'communication',
          title: `Reacted :${reaction.reaction}:`,
          description: null,
          metadata: {
            channel_id: reaction.channel_id,
            message_ts: reaction.message_ts,
            reaction: reaction.reaction,
          },
          related_id: `${reaction.channel_id}:${reaction.message_ts}`,
          engagement_value: 1,
          occurred_at: reaction.occurred_at,
          source: 'slack',
        };
      })
      .filter(a => a !== null);

    console.log(`Transformed: ${messageActivities.length} message activities, ${reactionActivities.length} reaction activities`);

    // STEP 6: DELETE existing Slack activities in date range (reprocessability)
    console.log(`Deleting existing Slack activities in date range`);
    const { error: deleteError } = await supabase
      .from("member_activities")
      .delete()
      .eq("source", "slack")
      .gte("occurred_at", fromDate)
      .lte("occurred_at", toDate);

    if (deleteError) {
      console.error("Error deleting existing activities:", deleteError);
      throw deleteError;
    }

    // STEP 7: INSERT all activities (batched)
    const allActivities = [...messageActivities, ...reactionActivities];
    let inserted = 0;

    if (allActivities.length > 0) {
      const CHUNK_SIZE = 500;
      const chunks = chunk(allActivities, CHUNK_SIZE);

      const insertResults = await Promise.all(
        chunks.map(batch => supabase.from("member_activities").insert(batch))
      );

      const failedChunks = insertResults.filter(r => r.error);
      if (failedChunks.length > 0) {
        console.error(`Failed to insert ${failedChunks.length} chunks:`, failedChunks[0].error);
        throw failedChunks[0].error;
      }

      inserted = allActivities.length;
    }

    console.log(`Processing complete: inserted ${inserted} activities`);

    return NextResponse.json({
      success: true,
      processed: {
        messages: messageActivities.length,
        reactions: reactionActivities.length,
        total_activities: inserted,
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

async function loadAllMessages(supabase: any, fromDate: string, toDate: string) {
  let allMessages: any[] = [];
  let offset = 0;
  const BATCH_SIZE = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data: batch } = await supabase
      .from("slack_messages")
      .select("*")
      .gte("occurred_at", fromDate)
      .lte("occurred_at", toDate)
      .is("deleted_at", null) // Skip deleted messages
      .order("occurred_at")
      .range(offset, offset + BATCH_SIZE - 1);

    if (batch && batch.length > 0) {
      allMessages = allMessages.concat(batch);
      offset += batch.length;
      hasMore = batch.length === BATCH_SIZE;
    } else {
      hasMore = false;
    }
  }

  return allMessages;
}

async function loadAllReactions(supabase: any, fromDate: string, toDate: string) {
  let allReactions: any[] = [];
  let offset = 0;
  const BATCH_SIZE = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data: batch } = await supabase
      .from("slack_reactions")
      .select("*")
      .gte("occurred_at", fromDate)
      .lte("occurred_at", toDate)
      .is("removed_at", null) // Skip removed reactions
      .order("occurred_at")
      .range(offset, offset + BATCH_SIZE - 1);

    if (batch && batch.length > 0) {
      allReactions = allReactions.concat(batch);
      offset += batch.length;
      hasMore = batch.length === BATCH_SIZE;
    } else {
      hasMore = false;
    }
  }

  return allReactions;
}

function calculateMessageValue(msg: any): number {
  let value = 1; // Base value for any message

  // Thread starter = higher value (initiates conversation)
  if (!msg.thread_ts) {
    value += 2;
  }

  // Thread reply = medium value (participates in conversation)
  if (msg.thread_ts && msg.thread_ts !== msg.message_ts) {
    value += 1;
  }

  // File share = extra value (content contribution)
  if (msg.files) {
    value += 2;
  }

  // Long message = more engagement
  if (msg.text && msg.text.length > 500) {
    value += 1;
  }

  return value;
}
