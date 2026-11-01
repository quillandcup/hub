import { afterAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseBillingRepository } from "@/lib/data/billing";
import { chunk } from "@/lib/supabase/paginate";
import { asJson } from "@/lib/data/json";
import { defineBillingContract, type BillingTable } from "@/tests/helpers/billing-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `${Date.now()}`;
const PREFIX = `bt${RUN}`;
let counter = 0;

const bronze = () => db.schema("bronze");

// Everything the contract stores carries this run's prefix in its key column, so a clear only removes it.
const KEYS = [
  ["kajabi_contacts", "kajabi_contact_id"],
  ["kajabi_customers", "kajabi_customer_id"],
  ["kajabi_purchases", "kajabi_purchase_id"],
  ["kajabi_offers", "kajabi_offer_id"],
  ["stripe_customers", "stripe_customer_id"],
  ["stripe_products", "stripe_product_id"],
  ["stripe_subscriptions", "stripe_subscription_id"],
] as const;

const clear = async () => {
  for (const [table, key] of KEYS) {
    const { error } = await bronze().from(table).delete().like(key, `${PREFIX}%`);
    if (error) throw new Error(error.message);
  }
};

async function insert<T extends (typeof KEYS)[number][0]>(table: T, rows: Record<string, unknown>[]) {
  for (let i = 0; i < rows.length; i += 500) {
    // The rows are typed by the contract's seeds; the generated insert types want every NOT NULL column named.
    const { error } = await bronze().from(table).insert(rows.slice(i, i + 500) as never);
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

afterAll(clear);

defineBillingContract("SupabaseBillingRepository", () => ({
  repo: () => new SupabaseBillingRepository(db),
  unique: (label) => `${PREFIX}${label}${++counter}`,
  seed: async (rows) => {
    await clear();
    const withData = <R extends { data?: unknown }>(list: R[] | undefined) => (list ?? []).map((r) => ({ ...r, data: asJson(r.data ?? {}) }));
    await insert("kajabi_contacts", withData(rows.kajabiContacts));
    await insert("kajabi_customers", withData(rows.kajabiCustomers));
    await insert("kajabi_purchases", withData(rows.kajabiPurchases));
    await insert("kajabi_offers", withData(rows.kajabiOffers));
    await insert("stripe_customers", withData(rows.stripeCustomers));
    await insert("stripe_products", withData(rows.stripeProducts));
    await insert("stripe_subscriptions", withData(rows.stripeSubscriptions));
  },
  stored: async (table: BillingTable, column: string, values: string[]) => {
    const rows: Record<string, unknown>[] = [];
    for (const part of chunk(values, 100)) {
      const { data, error } = await bronze().from(table).select("*").in(column as never, part as never);
      if (error) throw new Error(error.message);
      rows.push(...((data ?? []) as unknown as Record<string, unknown>[]));
    }
    return rows;
  },
  removeStored: async (table: BillingTable, column: string, values: string[]) => {
    for (const part of chunk(values, 100)) {
      const { error } = await bronze().from(table).delete().in(column as never, part as never);
      if (error) throw new Error(error.message);
    }
  },
}));
