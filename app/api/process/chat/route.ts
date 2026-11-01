import { createRepos } from "@/lib/data/repos";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { NextRequest, NextResponse } from "next/server";
import { loadVerifiedSlackLinks, matchSlackUsersToMembers } from "@/lib/slack-matching";
import { splitIntoWindows } from "@/lib/processing/date-windows";
import { retryUnsentChatMessages } from "@/lib/chat/slack-post";
import { sweepDeletedFileBytes } from "@/lib/chat/file-cleanup";
import { purgeStagedChatFiles } from "@/lib/chat/staging";
import { clock } from "@/lib/clock";
import { invalidateChatLookups } from "@/lib/chat/invalidate-lookups";

// Extend timeout for processing large batches
export const maxDuration = 300; // 5 minutes

// Days of Slack history per project_slack_chat_messages call. A week still hit Postgres's 8s
// statement timeout on a 90-day import in prod (thousands of reaction and content rows rewritten
// per call), so a day keeps each call well under it.
const PROJECTION_WINDOW_DAYS = 1;
const BATCH_SIZE = 1000;

/** What the reprocess functions report (their jsonb result, as the generated types see it: any JSON). */
type ReprocessCounts = { messages?: number; reactions?: number };
type ChannelCounts = { channels?: number; members?: number };

/**
 * Process Bronze Slack data into the chat mirror (chat_channels, chat_channel_members,
 * chat_messages, chat_message_contents, chat_reactions). See docs/SLACK_BRIDGED_CHAT.md.
 *
 * 1. Matches Slack users to members in memory (same matching as /api/process/slack)
 * 2. Projects channels and membership (cheap, whole workspace) in one call
 * 3. Projects messages, contents, threads and reactions one day per call
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
    const parsed = await request.json().catch(() => undefined);
    if (parsed === undefined) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    const { fromDate, toDate } = parsed;
    if (!fromDate || !toDate) {
      return NextResponse.json({ error: "fromDate and toDate are required" }, { status: 400 });
    }

    console.log(`Projecting Slack chat from ${fromDate} to ${toDate}`);

    // STEP 1: Load reference data upfront (members and aliases can exceed 1000 rows)
    const members = await createRepos(supabase).members.identities();
    const aliases = await createRepos(supabase).aliases.nameAliases({ activeOnly: true });
    const slackUsers = await createRepos(supabase).slackUsers.list();

    // STEP 2: Match Slack users to members (in memory)
    const userMemberMap = Object.fromEntries(
      await matchSlackUsersToMembers(slackUsers, members, aliases, await loadVerifiedSlackLinks(createRepos(supabase)))
    );

    // STEP 3: Channels and membership
    const { data: channelResult, error: channelError } = await supabase.rpc("project_slack_chat_channels", {
      user_member_map: userMemberMap,
    });
    if (channelError) {
      console.error("Error projecting Slack chat channels:", channelError);
      throw channelError;
    }

    // STEP 4: Messages, one day per call. Each call is one transaction, so a failed week
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
      messages += (result as ReprocessCounts | null)?.messages ?? 0;
      reactions += (result as ReprocessCounts | null)?.reactions ?? 0;
    }

    console.log(
      `Chat projection complete: ${messages} messages, ${reactions} reactions in ${windows.length} daily windows`
    );

    // The outbox: Hub-written messages Slack never took. After the projection, so one whose
    // Slack event did arrive is already linked and isn't posted a second time.
    const outbox = await retryUnsentChatMessages(supabase).catch((error) => {
      console.error("Error retrying unsent chat messages:", error);
      return { sent: 0, failed: 0, expired: 0 };
    });

    // Attachments nobody sent.
    const purgedStaged = await purgeStagedChatFiles(supabase, clock.now()).catch((error) => {
      console.error("Error purging staged chat files:", error);
      return 0;
    });

    // Deleted files whose bytes are still in the bucket (a removal that failed earlier).
    const sweptFiles = await sweepDeletedFileBytes(supabase).catch((error) => {
      console.error("Error sweeping deleted chat file bytes:", error);
      return { removed: 0, failed: 1 };
    });
    if (sweptFiles.removed > 0 || sweptFiles.failed > 0) {
      console.log(`Deleted chat files swept: ${sweptFiles.removed} removed, ${sweptFiles.failed} failed`);
    }

    invalidateChatLookups();
    return NextResponse.json({
      success: true,
      processed: {
        purgedStaged,
        sweptFiles,
        channels: (channelResult as ChannelCounts | null)?.channels ?? 0,
        members: (channelResult as ChannelCounts | null)?.members ?? 0,
        messages,
        reactions,
        outboxSent: outbox.sent,
        outboxFailed: outbox.failed,
        outboxExpired: outbox.expired,
      },
    });
  } catch (error: any) {
    console.error("Error projecting Slack chat:", error);
    return NextResponse.json({ error: error.message || "Failed to project Slack chat" }, { status: 500 });
  }
}
