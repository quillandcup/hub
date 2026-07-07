import { requireAdmin } from "@/lib/supabase/api-auth";
import { triggerZoomImport } from "@/lib/processing/trigger";
import { NextRequest, NextResponse } from "next/server";

// Extend timeout for reconciliation jobs
export const maxDuration = 300; // 5 minutes (max for Hobby tier)

/**
 * Daily reconciliation job for Zoom attendance data.
 * Thin GET wrapper around triggerZoomImport so Vercel Cron can invoke it
 * (cron requires GET; the actual logic lives in /api/import/zoom).
 *
 * Scheduled to run daily at 2:30am via Vercel Cron.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const now = new Date();
    const fromDate = new Date(now);
    fromDate.setDate(fromDate.getDate() - 90);

    const result = await triggerZoomImport({
      fromDate: fromDate.toISOString().split('T')[0],
      toDate: now.toISOString().split('T')[0],
    });

    return NextResponse.json({ success: true, reconciliation: "zoom", ...result });
  } catch (error: any) {
    console.error("[Reconciliation] Error in Zoom reconciliation:", error);
    return NextResponse.json(
      { error: error.message || "Failed to reconcile Zoom data" },
      { status: 500 }
    );
  }
}
