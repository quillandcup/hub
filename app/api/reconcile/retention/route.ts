import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { enforceNetworkRetention, NETWORK_RETENTION_BUDGET_MS } from "@/lib/retention/network-details";
import { rollUpAndPruneUsageEvents } from "@/lib/retention/usage-events";
import { clock } from "@/lib/clock";
import { pingCronHeartbeat } from "@/lib/cron-heartbeats";

export const maxDuration = 300; // 5 minutes (max for Hobby tier)

/**
 * Nightly enforcement of what /privacy promises about how long things are kept (constants in lib/retention.ts):
 *
 * 1. Raw network details: keeps the browser and device of every visit, then removes the exact IP address and the
 *    user-agent string from rows older than `rawNetworkDays` (lib/retention/network-details.ts).
 * 2. Usage statistics: rolls the completed days, weeks and months up into anonymous totals, then removes usage
 *    events older than `usageMonths` whose totals are kept (lib/retention/usage-events.ts).
 *
 * Both share one time budget; whatever doesn't fit is picked up the next night.
 *
 * Scheduled to run daily at 4:00am via Vercel Cron. Vercel Cron always invokes via GET.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const db = createServiceRoleClient();
    const startedAt = clock.now();
    const network = await enforceNetworkRetention(db);
    const usage = await rollUpAndPruneUsageEvents(db, { budgetMs: Math.max(0, NETWORK_RETENTION_BUDGET_MS - (clock.now() - startedAt)) });
    console.log("[Reconciliation] Retention complete:", { network, usage });
    await pingCronHeartbeat("reconcile-retention");
    return NextResponse.json({ success: true, reconciliation: "retention", network, usage });
  } catch (error: any) {
    console.error("[Reconciliation] Error enforcing retention:", error);
    return NextResponse.json({ error: error.message || "Failed to enforce retention" }, { status: 500 });
  }
}
