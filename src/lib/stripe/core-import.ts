import type Stripe from "stripe";
import type { BillingRepository } from "@/lib/data/billing";
import { asJson } from "@/lib/data/json";
import type { createStripeClient } from "@/lib/stripe/client";

type StripeClient = ReturnType<typeof createStripeClient>;

export interface StripeCoreResult {
  customers: number;
  products: number;
  subscriptions: number;
  statusBreakdown: Record<string, number>;
  importTimestamp: string;
}

const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

/**
 * Imports Stripe customers, products and subscriptions (every status) into Bronze. Upsert on Stripe's id only:
 * nothing is deleted or marked because a record is missing from a fetch, so a partial or failed fetch cannot
 * remove anything. Shared by the manual import and the nightly /api/reconcile/stripe-billing.
 */
export async function importStripeCore(
  billing: Pick<BillingRepository, "upsertStripeCustomers" | "upsertStripeProducts" | "upsertStripeSubscriptions">,
  stripe: Pick<StripeClient, "fetchAllCustomers" | "fetchAllProducts" | "fetchAllSubscriptions">,
): Promise<StripeCoreResult> {
  const importTimestamp = new Date().toISOString();

  console.log("Fetching customers from Stripe API...");
  const customers = await stripe.fetchAllCustomers();
  const customerRecords = customers.map((customer) => ({
    stripe_customer_id: customer.id,
    email: customer.email?.toLowerCase() || null,
    name: customer.name,
    created_at_stripe: iso(customer.created),
    imported_at: importTimestamp,
    data: asJson(customer),
  }));
  await billing.upsertStripeCustomers(customerRecords).catch((error: Error) => {
    console.error("Error upserting stripe_customers:", error);
    throw new Error(`Customers import failed: ${error.message}`);
  });

  console.log("Fetching products from Stripe API...");
  const products = await stripe.fetchAllProducts();
  const productRecords = products.map((product) => ({
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

  // Stripe's list endpoint excludes canceled subscriptions unless status is explicitly "all"; omitting it
  // silently drops every cancelled member's subscription (and their real trial_start/trial_end).
  console.log("Fetching subscriptions from Stripe API...");
  const subscriptions = await stripe.fetchAllSubscriptions("all");
  const subscriptionRecords = subscriptions.map((subscription: Stripe.Subscription) => {
    const periodStart = (subscription as any).current_period_start;
    const periodEnd = (subscription as any).current_period_end;
    return {
      stripe_subscription_id: subscription.id,
      stripe_customer_id: typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id,
      status: subscription.status,
      current_period_start: periodStart ? iso(periodStart) : null,
      current_period_end: periodEnd ? iso(periodEnd) : null,
      canceled_at: subscription.canceled_at ? iso(subscription.canceled_at) : null,
      created_at_stripe: iso(subscription.created),
      pause_collection: asJson(subscription.pause_collection),
      imported_at: importTimestamp,
      data: asJson(subscription),
    };
  });
  await billing.upsertStripeSubscriptions(subscriptionRecords).catch((error: Error) => {
    console.error("Error upserting stripe_subscriptions:", error);
    throw new Error(`Subscriptions import failed: ${error.message}`);
  });

  return {
    customers: customerRecords.length,
    products: productRecords.length,
    subscriptions: subscriptionRecords.length,
    statusBreakdown: subscriptions.reduce(
      (acc, sub) => {
        acc[sub.status] = (acc[sub.status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    ),
    importTimestamp,
  };
}
