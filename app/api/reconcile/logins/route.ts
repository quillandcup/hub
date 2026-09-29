import { requireAdmin } from "@/lib/supabase/api-auth";
import { mirrorLoginEvents } from "@/lib/processing/login-events";
import { pingCronHeartbeat } from "@/lib/cron-heartbeats";
import { NextRequest, NextResponse } from "next/server";

// Extend timeout for reconciliation jobs
export const maxDuration = 300; // 5 minutes (max for Hobby tier)

const LOOKBACK_DAYS = 90;

/**
 * Daily reconciliation job for Hedgie Hub logins.
 * Mirrors recent auth.sessions into member_activities as hedgie_hub_login
 * activities. A 90-day lookback, like the other reconcile jobs, backfills
 * any run that was missed or failed (e.g. bad credentials) — the mirror is
 * dedupe-safe. It can only recover sessions still in auth.sessions: a login
 * whose session was signed out before the backfill ran is gone.
 *
 * Scheduled to run daily at 3:15am via Vercel Cron.
 * Vercel Cron always invokes via GET.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  try {
    console.log(`[Reconciliation] Starting login activity mirror`);

    const to = new Date();
    const from = new Date(to.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const result = await mirrorLoginEvents(supabase, { from, to });

    console.log(`[Reconciliation] Login activity mirror complete:`, result);

    await pingCronHeartbeat("reconcile-logins");

    return NextResponse.json({
      success: true,
      reconciliation: "logins",
      ...result,
    });
  } catch (error: any) {
    console.error("[Reconciliation] Error mirroring login activity:", error);
    return NextResponse.json(
      { error: error.message || "Failed to mirror login activity" },
      { status: 500 }
    );
  }
}
