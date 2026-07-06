import { requireAdmin } from "@/lib/supabase/api-auth";
import { triggerKajabiSync } from "@/lib/processing/trigger";
import { NextRequest, NextResponse } from "next/server";

// Extend timeout for reconciliation jobs
export const maxDuration = 300; // 5 minutes (max for Hobby tier)

/**
 * Daily reconciliation job for member data
 * Fetches fresh data from Kajabi API (contacts, customers, purchases, offers),
 * imports to Bronze layer, then processes Silver layer (members table).
 *
 * Scheduled to run daily at 3am via Vercel Cron
 * Vercel Cron always invokes via GET.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    console.log(`[Reconciliation] Starting member reconciliation via Kajabi API`);

    const result = await triggerKajabiSync();

    console.log(`[Reconciliation] Member reconciliation complete`);

    return NextResponse.json({
      success: true,
      reconciliation: "members",
      ...result,
    });
  } catch (error: any) {
    console.error("[Reconciliation] Error in member reconciliation:", error);
    return NextResponse.json(
      { error: error.message || "Failed to reconcile members" },
      { status: 500 }
    );
  }
}
