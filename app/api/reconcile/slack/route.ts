import { requireAdmin } from "@/lib/supabase/api-auth";
import { triggerSlackSync } from "@/lib/processing/trigger";
import { pingCronHeartbeat } from "@/lib/cron-heartbeats";
import { NextRequest, NextResponse } from "next/server";

// Extend timeout for reconciliation jobs
export const maxDuration = 300; // 5 minutes (max for Hobby tier)

/**
 * Daily reconciliation job for Slack data.
 * Fetches recent channel history (messages + reactions) from the Slack API,
 * imports to Bronze layer, then processes Silver layer (member_activities).
 *
 * Backstops the Slack Events API webhook — catches anything a missed or
 * failed webhook delivery would otherwise drop permanently.
 *
 * Scheduled to run daily at 2:45am via Vercel Cron.
 * Vercel Cron always invokes via GET.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    console.log(`[Reconciliation] Starting Slack reconciliation via Slack API`);

    const result = await triggerSlackSync({ daysBack: 90 });

    // Threads still behind Slack wait for the next run (nothing else tracks
    // them). Only ping the heartbeat when none were left, so a backlog that
    // keeps not clearing alerts instead of looking healthy. On Slack's free
    // plan a thread left behind long enough falls out of its 90-day history.
    const behindDeferred = result.fetched?.threadsBehindDeferred ?? 0;
    // Membership, emoji or file capture failing is a partial failure too: on
    // the free plan, data that isn't captured in time can't be fetched later.
    const captureErrors: string[] = result.capture?.errors ?? [];
    if (behindDeferred > 0) {
      console.warn(`[Reconciliation] Slack reconciliation left ${behindDeferred} threads behind; next run continues`);
    } else if (captureErrors.length > 0) {
      console.warn(`[Reconciliation] Slack reconciliation saved messages but part of the capture failed:`, captureErrors);
    } else {
      console.log(`[Reconciliation] Slack reconciliation complete`);
      await pingCronHeartbeat("reconcile-slack");
    }

    return NextResponse.json({
      success: true,
      reconciliation: "slack",
      ...result,
    });
  } catch (error: any) {
    console.error("[Reconciliation] Error in Slack reconciliation:", error);
    return NextResponse.json(
      { error: error.message || "Failed to reconcile Slack data" },
      { status: 500 }
    );
  }
}
