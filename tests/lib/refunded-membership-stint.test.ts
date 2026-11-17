import { describe, it, expect, vi } from "vitest";
import { buildMembershipStints, fetchStripeTrialInfoByEmail } from "@/lib/kajabi/membership-history";
import { computeMemberTenure } from "@/lib/member-tenure";
import { InMemoryBillingRepository } from "@/lib/data/billing";
import { InMemoryDataset } from "@/lib/data/in-memory";

// A trial that converts, is charged, and is cancelled and refunded the same
// day was never a membership. Counting it as a stint made the member's first
// join date that conversion day and pushed every Hedgieversary out by the
// gap before her real membership.

const OFFER = { name: "Quill & Cup Membership", data: { attributes: { subscription: true } } };
const offerMap = new Map([["offer-1", OFFER]]);
const EMAIL = "ada@example.com";

function purchase(id: string, createdAt: string, deactivatedAt: string | null) {
  return {
    created_at_kajabi: createdAt,
    effective_start_at: createdAt,
    deactivated_at: deactivatedAt,
    status: deactivatedAt ? "canceled" : "active",
    kajabi_offer_id: "offer-1",
    kajabi_customer_id: id,
  };
}

function seededBilling() {
  const unix = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
  const dataset = new InMemoryDataset();
  Object.assign(dataset, {
    stripeCustomers: [{ stripe_customer_id: "cus_ada", email: EMAIL }],
    stripeSubscriptions: [
      {
        // First trial: converted, charged, cancelled 8 hours later, refunded.
        stripe_subscription_id: "sub_first",
        stripe_customer_id: "cus_ada",
        status: "canceled",
        created_at_stripe: "2024-11-16T09:15:43Z",
        canceled_at: "2024-11-23T17:07:37Z",
        data: { trial_start: unix("2024-11-16T09:15:43Z"), trial_end: unix("2024-11-23T09:15:43Z") },
      },
      {
        // Second trial: still a member.
        stripe_subscription_id: "sub_second",
        stripe_customer_id: "cus_ada",
        status: "active",
        created_at_stripe: "2026-05-12T14:55:45Z",
        canceled_at: null,
        data: { trial_start: unix("2026-05-12T14:55:45Z"), trial_end: unix("2026-05-19T14:55:45Z") },
      },
    ],
    stripeInvoices: [
      { stripe_invoice_id: "in_first", stripe_customer_id: "cus_ada", stripe_subscription_id: "sub_first", amount_paid: 4700 },
      { stripe_invoice_id: "in_second", stripe_customer_id: "cus_ada", stripe_subscription_id: "sub_second", amount_paid: 4700 },
    ],
    stripeCharges: [
      { stripe_charge_id: "ch_first", stripe_customer_id: "cus_ada", stripe_invoice_id: "in_first", amount: 4700, amount_refunded: 4700, refunded: true },
      { stripe_charge_id: "ch_second", stripe_customer_id: "cus_ada", stripe_invoice_id: "in_second", amount: 4700 },
    ],
  });
  return new InMemoryBillingRepository(dataset);
}

const purchases = [
  purchase("p1", "2024-11-16T09:15:43.218Z", "2024-11-23T17:07:38.679Z"),
  purchase("p2", "2026-05-12T14:55:44.555Z", null),
];

describe("a trial that was charged, cancelled and refunded in full", () => {
  it("is not a membership stint, so the real membership is the first one", async () => {
    const billing = seededBilling();
    const stripeInfo = await fetchStripeTrialInfoByEmail({ billing } as never, []);

    const stints = buildMembershipStints(purchases, offerMap, EMAIL, stripeInfo);

    expect(stints).toHaveLength(1);
    expect(stints[0].created_at_kajabi).toBe(new Date("2026-05-19T14:55:45Z").toISOString());
  });

  it("makes the Hedgieversary count from the real start, with no gap", async () => {
    const billing = seededBilling();
    const stripeInfo = await fetchStripeTrialInfoByEmail({ billing } as never, []);
    const stints = buildMembershipStints(purchases, offerMap, EMAIL, stripeInfo);

    const tenure = computeMemberTenure(stints, [], new Date("2026-11-16T12:00:00Z"));

    expect(tenure.firstJoinedAt).toBe("2026-05-19");
  });

  it("still counts that stint when the refund was not in full", async () => {
    const billing = seededBilling();
    await billing.upsertStripeCharges([{ stripe_charge_id: "ch_first", amount_refunded: 1000, refunded: false } as never]);
    const stripeInfo = await fetchStripeTrialInfoByEmail({ billing } as never, []);

    const stints = buildMembershipStints(purchases, offerMap, EMAIL, stripeInfo);

    expect(stints).toHaveLength(2);
  });

  it("still counts it when the subscription kept running after the refund", async () => {
    const billing = seededBilling();
    await billing.upsertStripeSubscriptions([
      { stripe_subscription_id: "sub_first", stripe_customer_id: "cus_ada", status: "active", canceled_at: null } as never,
    ]);
    const stripeInfo = await fetchStripeTrialInfoByEmail({ billing } as never, []);

    const stints = buildMembershipStints(purchases, offerMap, EMAIL, stripeInfo);

    expect(stints).toHaveLength(2);
  });
});

describe("fetchMembershipHistory Stripe repos", () => {
  it("reads Stripe through the repos passed for it, not the caller's", async () => {
    const { fetchMembershipHistory } = await import("@/lib/kajabi/membership-history");
    const { createInMemoryRepos } = await import("@/lib/data/repos");
    const customers = { stripeCustomers: [{ stripe_customer_id: "cus_x", email: EMAIL }] };
    const denied = createInMemoryRepos(new InMemoryDataset(customers));
    const stripeSpy = vi.fn(async () => new Set<string>());
    denied.billing.fullyRefundedStripeSubscriptionIds = async () => {
      throw new Error("permission denied for table stripe_charges");
    };
    const service = createInMemoryRepos(
      new InMemoryDataset(customers));
    service.billing.fullyRefundedStripeSubscriptionIds = stripeSpy;
    denied.billing.kajabiPurchasesByCustomers = async () => [purchase("c1", "2025-01-01T00:00:00Z", null)] as never;
    denied.billing.kajabiOffersByIds = async () => [{ kajabi_offer_id: "offer-1", name: OFFER.name, data: OFFER.data, trial_period_days: null }] as never;
    denied.billing.kajabiCustomers = async () => [] as never;
    service.aliases.emailAliases = async () => [];
    denied.aliases.emailAliases = async () => [];
    await expect(fetchMembershipHistory(denied, ["c1"])).rejects.toThrow();
    await fetchMembershipHistory(denied, ["c1"], service);
    expect(stripeSpy).toHaveBeenCalled();
  });
});
