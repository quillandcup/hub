import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { enforceNetworkRetention } from "@/lib/retention/network-details";
import { pingCronHeartbeat } from "@/lib/cron-heartbeats";

export const maxDuration = 300; // 5 minutes (max for Hobby tier)

/**
 * Nightly enforcement of what /privacy promises about raw network details: keeps the browser and device of every
 * visit, then removes the exact IP address and the user-agent string from rows older than
 * `RETENTION.rawNetworkDays` (lib/retention.ts). See lib/retention/network-details.ts.
 *
 * Scheduled to run daily at 4:00am via Vercel Cron. Vercel Cron always invokes via GET.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const result = await enforceNetworkRetention(createServiceRoleClient());
    console.log("[Reconciliation] Network retention complete:", result);
    await pingCronHeartbeat("reconcile-retention");
    return NextResponse.json({ success: true, reconciliation: "retention", ...result });
  } catch (error: any) {
    console.error("[Reconciliation] Error enforcing network retention:", error);
    return NextResponse.json({ error: error.message || "Failed to enforce network retention" }, { status: 500 });
  }
}
