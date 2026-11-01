import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryBillingRepository } from "@/lib/data/billing";
import { defineBillingContract, type BillingTable } from "@/tests/helpers/billing-contract";

const ARRAYS: Record<BillingTable, keyof InMemoryDataset> = {
  kajabi_contacts: "kajabiContacts",
  kajabi_customers: "kajabiCustomers",
  kajabi_purchases: "kajabiPurchases",
  kajabi_offers: "kajabiOffers",
  kajabi_members: "kajabiMembers",
  stripe_customers: "stripeCustomers",
  stripe_products: "stripeProducts",
  stripe_subscriptions: "stripeSubscriptions",
  subscription_history: "subscriptionHistory",
};

defineBillingContract("InMemoryBillingRepository", () => {
  const data = new InMemoryDataset();
  let n = 0;
  const rows = (table: BillingTable) => data[ARRAYS[table]] as unknown as Record<string, unknown>[];
  return {
    repo: () => new InMemoryBillingRepository(data),
    unique: (label) => `T${label}${++n}`,
    seed: async (seed) => {
      data.kajabiContacts = (seed.kajabiContacts ?? []).map((r) => ({ ...r }));
      data.kajabiCustomers = (seed.kajabiCustomers ?? []).map((r) => ({ ...r }));
      data.kajabiPurchases = (seed.kajabiPurchases ?? []).map((r) => ({ ...r }));
      data.kajabiOffers = (seed.kajabiOffers ?? []).map((r) => ({ ...r }));
      data.stripeCustomers = (seed.stripeCustomers ?? []).map((r) => ({ ...r }));
      data.stripeProducts = (seed.stripeProducts ?? []).map((r) => ({ ...r }));
      data.stripeSubscriptions = (seed.stripeSubscriptions ?? []).map((r) => ({ ...r }));
    },
    stored: async (table, column, values) => rows(table).filter((r) => values.includes(r[column] as string)),
    removeStored: async (table, column, values) => {
      const kept = rows(table).filter((r) => !values.includes(r[column] as string));
      (data[ARRAYS[table]] as unknown as Record<string, unknown>[]) = kept;
    },
  };
});
