import { requireAdmin } from "@/lib/supabase/api-auth";
import { mirrorLoginEvents } from "@/lib/processing/login-events";
import { NextRequest, NextResponse } from "next/server";

// Extend timeout for reconciliation jobs
export const maxDuration = 300; // 5 minutes (max for Hobby tier)

/**
 * Daily reconciliation job for Hedgie Hub logins.
 * Mirrors recent auth.sessions into member_activities as hedgie_hub_login
 * activities. A 48h lookback (wider than the 24h cron cadence) is a cheap
 * safety net against a missed/failed run — the upsert is dedupe-safe.
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
    const from = new Date(to.getTime() - 48 * 60 * 60 * 1000);
    const result = await mirrorLoginEvents(supabase, { from, to });

    console.log(`[Reconciliation] Login activity mirror complete:`, result);

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
