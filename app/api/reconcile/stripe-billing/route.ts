import { NextRequest, NextResponse } from "next/server";
import { pingCronHeartbeat } from "@/lib/cron-heartbeats";
import { createRepos } from "@/lib/data/repos";
import { importStripeBilling, type StripeBillingResult } from "@/lib/stripe/billing-import";
import { importStripeCore, type StripeCoreResult } from "@/lib/stripe/core-import";
import { createStripeClient } from "@/lib/stripe/client";
import { requireAdmin } from "@/lib/supabase/api-auth";

export const maxDuration = 300;

/**
 * Nightly import of all Stripe data into Bronze: customers, products and subscriptions (`lib/stripe/core-import.ts`,
 * everything, upsert only, nothing is ever removed), then invoices and charges (`lib/stripe/billing-import.ts`:
 * what was created since the newest stored one, minus a safety window, plus the invoices still open or draft;
 * `?full=1` reads the whole history again). Upsert on Stripe's id, so a repeat run changes nothing.
 *
 * The two steps are independent: an error in one is reported and the other still runs. The heartbeat is pinged
 * only when both succeed; otherwise the route answers 500 naming each failure. A restricted key without access
 * to invoices and charges fails that step with the reason said.
 *
 * Scheduled daily at 04:30 UTC via Vercel Cron (GET). It pings its Checkly heartbeat when one is configured;
 * none is, for now (lib/cron-heartbeats.ts, `unmonitored`).
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const full = new URL(request.url).searchParams.get("full") === "1";
  const billing = createRepos(auth.supabase).billing;
  const message = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

  let stripe: ReturnType<typeof createStripeClient>;
  try {
    stripe = createStripeClient();
  } catch (error) {
    console.error("[Reconciliation] Error creating the Stripe client:", error);
    return NextResponse.json({ error: message(error, "Failed to create the Stripe client") }, { status: 500 });
  }

  let core: StripeCoreResult | undefined;
  let coreError: string | undefined;
  try {
    core = await importStripeCore(billing, stripe);
    console.log("[Reconciliation] Stripe customers, products and subscriptions:", core);
  } catch (error) {
    console.error("[Reconciliation] Error importing Stripe customers, products and subscriptions:", error);
    coreError = message(error, "Failed to import Stripe customers, products and subscriptions");
  }

  let invoices: StripeBillingResult | undefined;
  let invoicesError: string | undefined;
  try {
    invoices = await importStripeBilling(billing, stripe, { full });
    console.log("[Reconciliation] Stripe invoices and charges:", invoices);
  } catch (error) {
    console.error("[Reconciliation] Error importing Stripe invoices and charges:", error);
    invoicesError = message(error, "Failed to import Stripe invoices and charges");
  }

  if (coreError || invoicesError) {
    return NextResponse.json(
      { error: [coreError, invoicesError].filter(Boolean).join("; "), reconciliation: "stripe", core, coreError, invoices, invoicesError },
      { status: 500 },
    );
  }

  await pingCronHeartbeat("reconcile-stripe-billing");
  return NextResponse.json({ success: true, reconciliation: "stripe", core, invoices });
}
