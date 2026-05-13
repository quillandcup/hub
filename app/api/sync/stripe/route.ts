import { createClient } from "@/lib/supabase/server";
import { createStripeClient } from "@/lib/stripe/client";
import { NextRequest, NextResponse } from "next/server";

/**
 * Sync data from Stripe API
 *
 * This endpoint:
 * 1. Fetches subscriptions, customers, and products from Stripe API
 * 2. Imports to Bronze layer (stripe_subscriptions, stripe_customers, stripe_products)
 * 3. Stores raw data for comparison with Kajabi
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();

  // Check authentication
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
      data: customer,
    }));

    const { error: customersError } = await supabase
      .schema("bronze")
      .from("stripe_customers")
      .upsert(customerRecords, { onConflict: "stripe_customer_id" });

    if (customersError) {
      console.error("Error upserting stripe_customers:", customersError);
      throw new Error(`Customers import failed: ${customersError.message}`);
    }

    // 2. Fetch and import products
    console.log("Fetching products from Stripe API...");
    const products = await stripe.fetchAllProducts();

    const productRecords = products.map(product => ({
      stripe_product_id: product.id,
      name: product.name,
      active: product.active,
      imported_at: importTimestamp,
      data: product,
    }));

    const { error: productsError } = await supabase
      .schema("bronze")
      .from("stripe_products")
      .upsert(productRecords, { onConflict: "stripe_product_id" });

    if (productsError) {
      console.error("Error upserting stripe_products:", productsError);
      throw new Error(`Products import failed: ${productsError.message}`);
    }

    // 3. Fetch and import subscriptions (all statuses to understand full picture)
    console.log("Fetching subscriptions from Stripe API...");
    const subscriptions = await stripe.fetchAllSubscriptions(); // Gets all, not just active

    const subscriptionRecords = subscriptions.map(subscription => ({
      stripe_subscription_id: subscription.id,
      stripe_customer_id: subscription.customer,
      status: subscription.status,
      current_period_start: new Date((subscription as any).current_period_start * 1000).toISOString(),
      current_period_end: new Date((subscription as any).current_period_end * 1000).toISOString(),
      canceled_at: subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : null,
      created_at_stripe: new Date(subscription.created * 1000).toISOString(),
      pause_collection: subscription.pause_collection,
      imported_at: importTimestamp,
      data: subscription,
    }));

    const { error: subscriptionsError } = await supabase
      .schema("bronze")
      .from("stripe_subscriptions")
      .upsert(subscriptionRecords, { onConflict: "stripe_subscription_id" });

    if (subscriptionsError) {
      console.error("Error upserting stripe_subscriptions:", subscriptionsError);
      throw new Error(`Subscriptions import failed: ${subscriptionsError.message}`);
    }

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
