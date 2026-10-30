import { createRepos } from "@/lib/data/repos";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { createStripeClient } from "@/lib/stripe/client";
import { NextRequest, NextResponse } from "next/server";
import { asJson } from "@/lib/data/json";

/**
 * Sync data from Stripe API
 *
 * This endpoint:
 * 1. Fetches subscriptions, customers, and products from Stripe API
 * 2. Imports to Bronze layer (stripe_subscriptions, stripe_customers, stripe_products)
 * 3. Stores raw data for comparison with Kajabi
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  try {
    const results: any = {};

    // Create Stripe API client
    const stripe = createStripeClient();
    const importTimestamp = new Date().toISOString();

    // 1. Fetch and import customers
    console.log("Fetching customers from Stripe API...");
    const customers = await stripe.fetchAllCustomers();

    const customerRecords = customers.map(customer => ({
      stripe_customer_id: customer.id,
      email: customer.email?.toLowerCase() || null,
      name: customer.name,
      created_at_stripe: new Date(customer.created * 1000).toISOString(),
      imported_at: importTimestamp,
      data: asJson(customer),
    }));

    const billing = createRepos(supabase).billing;
    await billing.upsertStripeCustomers(customerRecords).catch((error: Error) => {
      console.error("Error upserting stripe_customers:", error);
      throw new Error(`Customers import failed: ${error.message}`);
    });

    // 2. Fetch and import products
    console.log("Fetching products from Stripe API...");
    const products = await stripe.fetchAllProducts();

    const productRecords = products.map(product => ({
      stripe_product_id: product.id,
      name: product.name,
      active: product.active,
      imported_at: importTimestamp,
      data: asJson(product),
    }));

    await billing.upsertStripeProducts(productRecords).catch((error: Error) => {
      console.error("Error upserting stripe_products:", error);
      throw new Error(`Products import failed: ${error.message}`);
    });

    // 3. Fetch and import subscriptions (all statuses to understand full picture)
    // Stripe's list endpoint excludes canceled subscriptions unless status is
    // explicitly "all" — omitting it silently drops every cancelled member's
    // subscription (and their real trial_start/trial_end), which is most of
    // the membership base.
    console.log("Fetching subscriptions from Stripe API...");
    const subscriptions = await stripe.fetchAllSubscriptions("all");

    const subscriptionRecords = subscriptions.map(subscription => ({
      stripe_subscription_id: subscription.id,
      stripe_customer_id: typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id,
      status: subscription.status,
      current_period_start: (subscription as any).current_period_start ? new Date((subscription as any).current_period_start * 1000).toISOString() : null,
      current_period_end: (subscription as any).current_period_end ? new Date((subscription as any).current_period_end * 1000).toISOString() : null,
      canceled_at: subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : null,
      created_at_stripe: new Date(subscription.created * 1000).toISOString(),
      pause_collection: asJson(subscription.pause_collection),
      imported_at: importTimestamp,
      data: asJson(subscription),
    }));

    await billing.upsertStripeSubscriptions(subscriptionRecords).catch((error: Error) => {
      console.error("Error upserting stripe_subscriptions:", error);
      throw new Error(`Subscriptions import failed: ${error.message}`);
    });

    results.stripe = {
      customers: customerRecords.length,
      products: productRecords.length,
      subscriptions: subscriptionRecords.length,
      statusBreakdown: subscriptions.reduce((acc, sub) => {
        acc[sub.status] = (acc[sub.status] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      importTimestamp,
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
