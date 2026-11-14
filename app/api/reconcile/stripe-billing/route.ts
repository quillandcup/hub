import { NextRequest, NextResponse } from "next/server";
import { pingCronHeartbeat } from "@/lib/cron-heartbeats";
import { createRepos } from "@/lib/data/repos";
import { importStripeBilling } from "@/lib/stripe/billing-import";
import { createStripeClient } from "@/lib/stripe/client";
import { requireAdmin } from "@/lib/supabase/api-auth";

export const maxDuration = 300;

/**
 * Nightly import of Stripe invoices and charges into Bronze (`lib/stripe/billing-import.ts`): what was created
 * since the newest stored one (minus a safety window), plus the invoices still open or draft. `?full=1` reads the
 * whole history again. Upsert on Stripe's id, so a repeat run changes nothing.
 *
 * Needs a Stripe key that may read invoices and charges; a restricted key without them fails the run with
 * that said, rather than importing nothing.
 *
 * Scheduled daily at 04:30 UTC via Vercel Cron (GET). It pings its Checkly heartbeat when one is configured;
 * none is, for now (lib/cron-heartbeats.ts, `unmonitored`).
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const full = new URL(request.url).searchParams.get("full") === "1";

  try {
    const result = await importStripeBilling(createRepos(auth.supabase).billing, createStripeClient(), { full });
    console.log("[Reconciliation] Stripe invoices and charges:", result);
    await pingCronHeartbeat("reconcile-stripe-billing");
    return NextResponse.json({ success: true, reconciliation: "stripe-billing", ...result });
  } catch (error) {
    console.error("[Reconciliation] Error importing Stripe invoices and charges:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to import Stripe invoices and charges" }, { status: 500 });
  }
}
