import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseBillingRepository } from "@/lib/data/billing";
import { importStripeCore } from "@/lib/stripe/core-import";
import { getTestSupabaseAdminClient } from "../../helpers/supabase";

/**
 * The Stripe customers, products and subscriptions import runs nightly and by hand, so it must be idempotent:
 * rows are keyed by Stripe's id, a second import creates no duplicates and a changed record updates in place.
 */
describe("Stripe customers, products and subscriptions import idempotency", () => {
  const supabase = getTestSupabaseAdminClient();
  const billing = new SupabaseBillingRepository(supabase as unknown as Db);
  const run = `${Date.now()}`;
  const customerId = `cus_idemcore${run}`;
  const productId = `prod_idemcore${run}`;
  const subId = `sub_idemcore${run}`;

  const source = (over: { status?: string; pause?: object | null; name?: string } = {}) => ({
    fetchAllCustomers: async () => [{ id: customerId, email: `Ada${run}@Example.test`, name: over.name ?? "Ada Example", created: 1_700_000_000 }],
    fetchAllProducts: async () => [{ id: productId, name: "Membership", active: true }],
    fetchAllSubscriptions: async () => [
      { id: subId, customer: customerId, status: over.status ?? "active", created: 1_700_000_000, canceled_at: null, pause_collection: over.pause ?? null },
    ],
  });

  const rows = async (table: string, column: string, id: string) => {
    const { data, error } = await supabase.schema("bronze").from(table).select("*").eq(column, id);
    if (error) throw new Error(error.message);
    return data ?? [];
  };

  const clear = async () => {
    await supabase.schema("bronze").from("stripe_subscriptions").delete().eq("stripe_subscription_id", subId);
    await supabase.schema("bronze").from("stripe_products").delete().eq("stripe_product_id", productId);
    await supabase.schema("bronze").from("stripe_customers").delete().eq("stripe_customer_id", customerId);
  };

  beforeAll(clear);
  afterAll(clear);

  it("creates the rows on the first import and creates no duplicates on repeats", async () => {
    await importStripeCore(billing, source() as never);
    expect(await rows("stripe_customers", "stripe_customer_id", customerId)).toHaveLength(1);
    expect(await rows("stripe_products", "stripe_product_id", productId)).toHaveLength(1);
    expect(await rows("stripe_subscriptions", "stripe_subscription_id", subId)).toHaveLength(1);

    await importStripeCore(billing, source() as never);
    await importStripeCore(billing, source() as never);
    expect(await rows("stripe_customers", "stripe_customer_id", customerId)).toHaveLength(1);
    expect(await rows("stripe_subscriptions", "stripe_subscription_id", subId)).toHaveLength(1);
  });

  it("updates a changed subscription and customer in place, and keeps rows a later fetch no longer lists", async () => {
    await importStripeCore(billing, source({ status: "paused", pause: { behavior: "void" }, name: "Ada Changed" }) as never);
    const [sub] = await rows("stripe_subscriptions", "stripe_subscription_id", subId);
    expect(sub).toMatchObject({ status: "paused", pause_collection: { behavior: "void" } });
    expect((await rows("stripe_customers", "stripe_customer_id", customerId))[0]).toMatchObject({ name: "Ada Changed" });

    const empty = { fetchAllCustomers: async () => [], fetchAllProducts: async () => [], fetchAllSubscriptions: async () => [] };
    await importStripeCore(billing, empty as never);
    expect(await rows("stripe_subscriptions", "stripe_subscription_id", subId)).toHaveLength(1);
  });
});
