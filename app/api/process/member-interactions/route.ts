import { requireAdmin } from "@/lib/supabase/api-auth";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { NextRequest, NextResponse } from "next/server";
import { splitIntoWindows } from "@/lib/processing/date-windows";

// Extend timeout for processing large batches
export const maxDuration = 300; // 5 minutes

// Days of chat per reprocess_member_interactions_atomic call. A week keeps each call well under
// Postgres's 8s statement timeout (same lesson as the Slack activity rebuild and the chat projection).
const REBUILD_WINDOW_DAYS = 7;

/**
 * Process the chat mirror into member_interactions (Silver): who talked with whom, built from the
 * chat tables for the member network graph. See docs/SLACK_BRIDGED_CHAT.md, "Silver: member_interactions".
 *
 * DELETE + INSERT by date range, one week per atomic call, so it is fully reprocessable from the chat
 * tables and a failed week changes nothing. Holds who, where and when, never what was said. Reads
 * message text (to find mentions), so it runs with the service role after the admin check.
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

    const totals = { thread_replies: 0, dms: 0, reactions: 0, mentions: 0 };
    const windows = splitIntoWindows(new Date(fromDate), new Date(toDate), REBUILD_WINDOW_DAYS);
    for (const window of windows) {
      const { data, error } = await supabase.rpc("reprocess_member_interactions_atomic", {
        from_date: window.from.toISOString(),
        to_date: window.to.toISOString(),
      });
      if (error) {
        console.error(`Error rebuilding member interactions (${window.from.toISOString()} to ${window.to.toISOString()}):`, error);
        throw error;
      }
      for (const key of Object.keys(totals) as (keyof typeof totals)[]) totals[key] += (data as Record<string, number> | null)?.[key] ?? 0;
    }

    console.log(
      `Member interactions complete: ${totals.thread_replies} replies, ${totals.dms} DMs, ${totals.reactions} reactions, ${totals.mentions} mentions in ${windows.length} weekly windows`
    );
    return NextResponse.json({ success: true, processed: { ...totals, windows: windows.length } });
  } catch (error: any) {
    console.error("Error processing member interactions:", error);
    return NextResponse.json({ error: error.message || "Failed to process member interactions" }, { status: 500 });
  }
}
