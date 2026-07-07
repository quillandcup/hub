import { requireAdmin } from "@/lib/supabase/api-auth";
import { triggerCalendarSync } from "@/lib/processing/trigger";
import { NextRequest, NextResponse } from "next/server";

// Extend timeout for reconciliation jobs
export const maxDuration = 300; // 5 minutes (max for Hobby tier)

/**
 * Daily reconciliation job for calendar events.
 * Thin GET wrapper around triggerCalendarSync so Vercel Cron can invoke it
 * (cron requires GET; the actual logic lives in /api/import/calendar).
 *
 * Scheduled to run daily at 2am via Vercel Cron.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const result = await triggerCalendarSync({ daysBack: 90, daysForward: 90 });
    return NextResponse.json({ success: true, reconciliation: "calendar", ...result });
  } catch (error: any) {
    console.error("[Reconciliation] Error in calendar reconciliation:", error);
    return NextResponse.json(
      { error: error.message || "Failed to reconcile calendar" },
      { status: 500 }
    );
  }
}
