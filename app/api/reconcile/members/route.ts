import { createClient } from "@/lib/supabase/server";
import { triggerReprocessing } from "@/lib/processing/trigger";
import { NextRequest, NextResponse } from "next/server";

// Extend timeout for reconciliation jobs
export const maxDuration = 300; // 5 minutes (max for Hobby tier)

/**
 * Daily reconciliation job for member data
 * Reprocesses member data from latest Bronze layer snapshot
 * This ensures Silver layer is up-to-date with latest Kajabi imports
 *
 * Note: Unlike calendar/zoom, this doesn't fetch from external API
 * because Kajabi data is imported via CSV uploads. This job ensures
 * the Silver layer (members table) is reconciled with the latest
 * Bronze layer data (kajabi_members snapshots).
 *
 * Scheduled to run daily at 3am via Vercel Cron
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();

  // Check authentication
  // For cron jobs, Vercel sends Authorization: Bearer <CRON_SECRET>
  // For manual testing, allow authenticated users
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Allow either cron secret or authenticated user
  const isAuthorizedCron = cronSecret && authHeader === `Bearer ${cronSecret}`;
  const isAuthenticatedUser = !!user;

  if (!isAuthorizedCron && !isAuthenticatedUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    console.log(`[Reconciliation] Starting member reconciliation`);

    // 1. Check if we have any Kajabi member data in Bronze layer
    const { data: kajabiMembers, error: fetchError } = await supabase
      .schema('bronze')
      .from("kajabi_members")
      .select("imported_at")
      .order("imported_at", { ascending: false })
      .limit(1);

    if (fetchError) {
      console.error("[Reconciliation] Error fetching kajabi_members:", fetchError);
      throw fetchError;
    }

    if (!kajabiMembers || kajabiMembers.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No Kajabi member data found in Bronze layer",
        processing: null,
      });
    }

    const latestImportDate = kajabiMembers[0].imported_at;
    console.log(`[Reconciliation] Latest Kajabi import: ${latestImportDate}`);

    // 2. Trigger Silver layer processing
    // This will use the latest snapshot from kajabi_members Bronze table
    console.log(`[Reconciliation] Triggering member processing`);

    const processingResult = await triggerReprocessing('kajabi_members', 'bronze');

    console.log(`[Reconciliation] Member reconciliation complete`);

    return NextResponse.json({
      success: true,
      reconciliation: "members",
      latestImport: latestImportDate,
      processing: processingResult,
    });
  } catch (error: any) {
    console.error("[Reconciliation] Error in member reconciliation:", error);
    return NextResponse.json(
      { error: error.message || "Failed to reconcile members" },
      { status: 500 }
    );
  }
}
