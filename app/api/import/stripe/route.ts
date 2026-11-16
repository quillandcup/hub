import { createRepos } from "@/lib/data/repos";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { createStripeClient } from "@/lib/stripe/client";
import { NextRequest, NextResponse } from "next/server";
import { importStripeCore } from "@/lib/stripe/core-import";
import { importStripeBilling, type StripeBillingResult } from "@/lib/stripe/billing-import";

export const maxDuration = 300;

/**
 * Sync data from Stripe API
 *
 * This endpoint:
 * 1. Fetches subscriptions, customers, and products from Stripe API
 * 2. Imports to Bronze layer (stripe_subscriptions, stripe_customers, stripe_products)
 * 3. Stores raw data for comparison with Kajabi
 * 4. Imports invoices and charges (bronze.stripe_invoices, stripe_charges): everything on the first run, then
 *    what changed since (`?full=1` reads the whole history again). The nightly /api/reconcile/stripe-billing
 *    does the same step on its own.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  try {
    const results: any = {};

    const stripe = createStripeClient();
    const billing = createRepos(supabase).billing;
    const core = await importStripeCore(billing, stripe);

    // 4. Invoices and charges (who was billed what and when). A key that may not read them must not undo the
    // import above, so the reason is reported beside the counts instead of failing the run.
    let billingResult: StripeBillingResult | undefined;
    let billingError: string | undefined;
    try {
      const full = new URL(request.url).searchParams.get("full") === "1";
      billingResult = await importStripeBilling(billing, stripe, { full });
    } catch (error) {
      console.error("Error importing Stripe invoices and charges:", error);
      billingError = error instanceof Error ? error.message : "Invoices and charges import failed";
    }

    results.stripe = {
      billing: billingResult,
      billingError,
      customers: core.customers,
      products: core.products,
      subscriptions: core.subscriptions,
      statusBreakdown: core.statusBreakdown,
      importTimestamp: core.importTimestamp,
    };

    return NextResponse.json({
      success: true,
      ...results,
    });
  } catch (error: any) {
    console.error("Error syncing Stripe data:", error);
    return NextResponse.json(
      {
        error: error.message || "Failed to sync Stripe data",
        details: error.stack,
      },
      { status: 500 }
    );
  }
}
