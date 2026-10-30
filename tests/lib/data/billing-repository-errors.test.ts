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
    ["kajabiCustomersByEmail", () => repo.kajabiCustomersByEmail(["a@example.test"])],
    ["kajabiCustomerProfilesByEmail", () => repo.kajabiCustomerProfilesByEmail(["a@example.test"])],
    ["kajabiCustomersByIds", () => repo.kajabiCustomersByIds(["c"])],
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
  ];

  it.each(calls)("%s throws instead of reading as empty", async (_name, call) => {
    await expect(call()).rejects.toThrow("boom");
  });
});
