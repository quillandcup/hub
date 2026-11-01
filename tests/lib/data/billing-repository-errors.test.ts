import { describe, it, expect } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseBillingRepository } from "@/lib/data/billing";

/** A client whose every query ends in a database error. */
function failingDb(): Db {
  const query: unknown = new Proxy(() => undefined, {
    get: (_target, prop) => (prop === "then" ? (resolve: (v: unknown) => void) => resolve({ data: null, error: { message: "boom" } }) : () => query),
  });
  return { schema: () => ({ from: () => query }) } as unknown as Db;
}

describe("SupabaseBillingRepository on a database error", () => {
  const repo = new SupabaseBillingRepository(failingDb());
  const calls: [string, () => Promise<unknown>][] = [
    ["kajabiContacts", () => repo.kajabiContacts()],
    ["kajabiContactRows", () => repo.kajabiContactRows()],
    ["kajabiContactData", () => repo.kajabiContactData("c")],
    ["lastKajabiContactImportAt", () => repo.lastKajabiContactImportAt()],
    ["kajabiCustomers", () => repo.kajabiCustomers()],
    ["kajabiCustomerRows", () => repo.kajabiCustomerRows()],
    ["kajabiCustomers by emails", () => repo.kajabiCustomers({ emails: ["a@example.test"] })],
    ["kajabiCustomerProfilesByEmail", () => repo.kajabiCustomerProfilesByEmail(["a@example.test"])],
    ["kajabiCustomers by ids", () => repo.kajabiCustomers({ customerIds: ["c"] })],
    ["kajabiOfferRows", () => repo.kajabiOfferRows()],
    ["kajabiOfferNames", () => repo.kajabiOfferNames()],
    ["kajabiOffersByName", () => repo.kajabiOffersByName(["n"])],
    ["kajabiOffersByIds", () => repo.kajabiOffersByIds(["o"])],
    ["kajabiPurchaseRows", () => repo.kajabiPurchaseRows()],
    ["kajabiPurchaseRows by offer", () => repo.kajabiPurchaseRows({ offerIds: ["o"], stillActive: true })],
    ["kajabiPurchases", () => repo.kajabiPurchases({ createdSince: "2024-01-01" })],
    ["kajabiPurchases by offer", () => repo.kajabiPurchases({ offerIds: ["o"] })],
    ["kajabiPurchasesByCustomers", () => repo.kajabiPurchasesByCustomers(["c"])],
    ["activeKajabiPurchaseCustomerIds", () => repo.activeKajabiPurchaseCustomerIds()],
    ["activeKajabiPurchaseCustomerIds by customer", () => repo.activeKajabiPurchaseCustomerIds(["c"])],
    ["lastKajabiPurchaseImportAt", () => repo.lastKajabiPurchaseImportAt()],
    ["stripeCustomers", () => repo.stripeCustomers()],
    ["stripeCustomers by email", () => repo.stripeCustomers({ emails: ["a@example.test"] })],
    ["stripeCustomersWithData", () => repo.stripeCustomersWithData()],
    ["stripeProductsByName", () => repo.stripeProductsByName(["n"])],
    ["stripeSubscriptionStatuses", () => repo.stripeSubscriptionStatuses(["active"])],
    ["stripeSubscriptionStatuses by customer", () => repo.stripeSubscriptionStatuses(["active"], ["c"])],
    ["stripeSubscriptionRows", () => repo.stripeSubscriptionRows()],
    ["stripeSubscriptionsWithStatus", () => repo.stripeSubscriptionsWithStatus("active")],
    ["stripeSubscriptionsByCustomers", () => repo.stripeSubscriptionsByCustomers(["c"])],
    ["lastStripeSubscriptionImportAt", () => repo.lastStripeSubscriptionImportAt()],
    ["upsertKajabiContacts", () => repo.upsertKajabiContacts([{ kajabi_contact_id: "c", email: "a@example.test", data: {} }])],
    ["setKajabiContactEmail", () => repo.setKajabiContactEmail("c", "a@example.test")],
    ["upsertKajabiCustomers", () => repo.upsertKajabiCustomers([{ kajabi_customer_id: "c", email: "a@example.test", data: {} }])],
    ["upsertKajabiPurchases", () => repo.upsertKajabiPurchases([{ kajabi_purchase_id: "p", data: {} }])],
    ["upsertKajabiOffers", () => repo.upsertKajabiOffers([{ kajabi_offer_id: "o", data: {} }])],
    ["insertKajabiMembers", () => repo.insertKajabiMembers([{ email: "a@example.test", data: {} }])],
    ["upsertStripeCustomers", () => repo.upsertStripeCustomers([{ stripe_customer_id: "c", data: {} }])],
    ["upsertStripeProducts", () => repo.upsertStripeProducts([{ stripe_product_id: "p", name: "n", data: {} }])],
    ["upsertStripeSubscriptions", () => repo.upsertStripeSubscriptions([{ stripe_subscription_id: "s", stripe_customer_id: "c", status: "active", data: {} }])],
    ["upsertSubscriptionHistory", () => repo.upsertSubscriptionHistory([{ kajabi_subscription_id: "s", customer_email: "a@example.test", status: "Active" }])],
  ];

  it.each(calls)("%s throws instead of reading as empty or reporting success", async (_name, call) => {
    await expect(call()).rejects.toThrow("boom");
  });
});
