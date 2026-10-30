import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryBillingRepository } from "@/lib/data/billing";
import { defineBillingContract } from "@/tests/helpers/billing-contract";

defineBillingContract("InMemoryBillingRepository", () => {
  const data = new InMemoryDataset();
  let n = 0;
  return {
    repo: () => new InMemoryBillingRepository(data),
    unique: (label) => `T${label}${++n}`,
    seed: async (rows) => {
      data.kajabiContacts = (rows.kajabiContacts ?? []).map((r) => ({ ...r }));
      data.kajabiCustomers = (rows.kajabiCustomers ?? []).map((r) => ({ ...r }));
      data.kajabiPurchases = (rows.kajabiPurchases ?? []).map((r) => ({ ...r }));
      data.kajabiOffers = (rows.kajabiOffers ?? []).map((r) => ({ ...r }));
      data.stripeCustomers = (rows.stripeCustomers ?? []).map((r) => ({ ...r }));
      data.stripeProducts = (rows.stripeProducts ?? []).map((r) => ({ ...r }));
      data.stripeSubscriptions = (rows.stripeSubscriptions ?? []).map((r) => ({ ...r }));
    },
  };
});
