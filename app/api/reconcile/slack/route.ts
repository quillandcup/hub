import { requireAdmin } from "@/lib/supabase/api-auth";
import { triggerSlackSync } from "@/lib/processing/trigger";
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

    const result = await triggerSlackSync({ daysBack: 3 });

    console.log(`[Reconciliation] Slack reconciliation complete`);

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
